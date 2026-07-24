const PARTICLE_TEXTURE_SIZE = 64;
const PARTICLE_COUNT = PARTICLE_TEXTURE_SIZE * PARTICLE_TEXTURE_SIZE;

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

void main() {
  vec2 position = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const UPDATE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uHomeTexture;
uniform vec2 uPointer;
uniform vec2 uPreviousPointer;
uniform vec2 uPointerVelocity;
uniform float uPointerActive;
uniform float uDeltaTime;
uniform float uTime;

layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outVelocity;

const int TEXTURE_SIZE = ${PARTICLE_TEXTURE_SIZE};
const int PARTICLE_TOTAL = ${PARTICLE_COUNT};

vec3 idleFlow(vec3 point, float seed) {
  float time = uTime * 0.28;
  return vec3(
    sin(point.y * 3.7 + point.z * 2.2 + time + seed * 5.0),
    cos(point.x * 3.1 - point.z * 2.8 - time * 0.8 + seed * 3.0),
    sin(point.x * 2.5 + point.y * 3.4 + time * 0.65 + seed * 7.0)
  );
}

ivec2 indexToCoordinate(int index) {
  return ivec2(index % TEXTURE_SIZE, index / TEXTURE_SIZE);
}

void main() {
  ivec2 coordinate = ivec2(gl_FragCoord.xy);
  int index = coordinate.y * TEXTURE_SIZE + coordinate.x;

  vec4 positionData = texelFetch(uPositionTexture, coordinate, 0);
  vec4 velocityData = texelFetch(uVelocityTexture, coordinate, 0);
  vec4 homeData = texelFetch(uHomeTexture, coordinate, 0);

  vec3 position = positionData.xyz;
  vec3 velocity = velocityData.xyz;
  vec3 home = homeData.xyz;
  float seed = fract(homeData.w);
  float material = floor(homeData.w);
  vec3 force = vec3(0.0);

  // Soft target memory brings the volume back after a disturbance without
  // making the particles feel pinned to a rigid mesh.
  float returnStrength = mix(1.12, 0.62, uPointerActive);
  returnStrength *= mix(0.88, 1.18, seed);
  force += (home - position) * returnStrength;

  // Nearby particles are ordered spatially before upload. These short rest-
  // length constraints provide surface tension and velocity matching: a small
  // PBD/SPH-inspired neighborhood that reads as cohesive oil rather than dust.
  const int neighborOffsets[8] = int[8](-1, 1, -2, 2, -4, 4, -8, 8);
  vec3 neighborVelocity = vec3(0.0);
  float neighborWeight = 0.0;

  for (int i = 0; i < 8; i++) {
    int neighborIndex = clamp(index + neighborOffsets[i], 0, PARTICLE_TOTAL - 1);
    ivec2 neighborCoordinate = indexToCoordinate(neighborIndex);
    vec3 neighborHome = texelFetch(uHomeTexture, neighborCoordinate, 0).xyz;
    float restLength = length(neighborHome - home);

    if (restLength > 0.008 && restLength < 0.34) {
      vec3 neighborPosition = texelFetch(uPositionTexture, neighborCoordinate, 0).xyz;
      vec3 separation = neighborPosition - position;
      float distanceToNeighbor = max(length(separation), 0.006);
      vec3 direction = separation / distanceToNeighbor;
      float constraint = distanceToNeighbor - restLength;

      force += direction * constraint * 3.15;
      if (distanceToNeighbor < restLength * 0.68) {
        force -= direction * (restLength * 0.68 - distanceToNeighbor) * 7.0;
      }

      neighborVelocity += texelFetch(uVelocityTexture, neighborCoordinate, 0).xyz;
      neighborWeight += 1.0;
    }
  }

  if (neighborWeight > 0.0) {
    vec3 averageVelocity = neighborVelocity / neighborWeight;
    force += (averageVelocity - velocity) * 1.05;
  }

  // Treat the cursor path as a swept 3D stirrer. The radial pressure opens a
  // channel while pointer velocity carries particles downstream and a depth
  // impulse rolls the channel edges into a small vortex.
  vec2 pointerSegment = uPointer - uPreviousPointer;
  vec2 fromPointer = position.xy - uPreviousPointer;
  float alongSegment = clamp(
    dot(fromPointer, pointerSegment) / max(dot(pointerSegment, pointerSegment), 0.0001),
    0.0,
    1.0
  );
  vec2 closestPointer = uPreviousPointer + pointerSegment * alongSegment;
  vec2 pointerDelta = position.xy - closestPointer;
  float pointerDistance = length(pointerDelta);
  float wake = smoothstep(0.36, 0.02, pointerDistance) * uPointerActive;
  vec2 radialDirection = pointerDelta / max(pointerDistance, 0.025);
  float pointerSpeed = length(uPointerVelocity);

  force.xy += radialDirection * wake * (3.6 + pointerSpeed * 0.38);
  force.xy += uPointerVelocity * wake * 0.92;
  force.z += wake * (
    dot(vec2(-radialDirection.y, radialDirection.x), uPointerVelocity) * 0.46 +
    sin(seed * 19.0 + uTime * 1.7) * 0.72
  );

  // Very low-amplitude circulation keeps a living edge without dissolving the
  // duck while nobody is interacting with it.
  force += idleFlow(position, seed) * mix(0.026, 0.045, seed);

  velocity += force * uDeltaTime;
  velocity *= exp(-1.36 * uDeltaTime);

  float speed = length(velocity);
  if (speed > 2.4) velocity *= 2.4 / speed;
  position += velocity * uDeltaTime;

  // Eye particles stay crisp enough to keep the silhouette readable.
  if (material > 2.5) {
    position = mix(position, home, 1.0 - exp(-2.4 * uDeltaTime));
    velocity *= exp(-1.4 * uDeltaTime);
  }

  outPosition = vec4(position, positionData.w);
  outVelocity = vec4(velocity, velocityData.w);
}`;

const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uPositionTexture;
uniform sampler2D uHomeTexture;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uYaw;
uniform float uPitch;

out float vMaterial;
out float vSeed;
out float vDepth;

const int TEXTURE_SIZE = ${PARTICLE_TEXTURE_SIZE};

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

void main() {
  ivec2 coordinate = ivec2(gl_VertexID % TEXTURE_SIZE, gl_VertexID / TEXTURE_SIZE);
  vec4 positionData = texelFetch(uPositionTexture, coordinate, 0);
  vec4 homeData = texelFetch(uHomeTexture, coordinate, 0);
  vec3 position = positionData.xyz;

  position.xz = rotate2d(uYaw) * position.xz;
  position.yz = rotate2d(uPitch) * position.yz;

  float viewZ = position.z - 3.45;
  float aspect = uResolution.x / uResolution.y;
  float focalLength = 2.18;
  float nearPlane = 0.1;
  float farPlane = 10.0;
  float projectionA = (farPlane + nearPlane) / (nearPlane - farPlane);
  float projectionB = (2.0 * farPlane * nearPlane) / (nearPlane - farPlane);

  gl_Position = vec4(
    position.x * focalLength / aspect,
    position.y * focalLength,
    projectionA * viewZ + projectionB,
    -viewZ
  );

  vMaterial = floor(homeData.w);
  vSeed = fract(homeData.w);
  vDepth = -viewZ;

  float perspective = 3.45 / max(vDepth, 0.5);
  float diameter = mix(3.1, 5.5, vSeed) * uPixelRatio * perspective;
  gl_PointSize = clamp(diameter, 2.4 * uPixelRatio, 7.2 * uPixelRatio);
}`;

const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vMaterial;
in float vSeed;
in float vDepth;

out vec4 outColor;

void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radiusSquared = dot(point, point);
  if (radiusSquared > 1.0) discard;

  vec3 normal = normalize(vec3(point.x, -point.y, sqrt(max(0.0, 1.0 - radiusSquared))));
  vec3 keyLight = normalize(vec3(-0.52, 0.72, 0.82));
  vec3 rimLight = normalize(vec3(0.74, 0.18, 0.65));
  float diffuse = max(dot(normal, keyLight), 0.0);
  float rim = pow(1.0 - normal.z, 2.2);
  float specular = pow(max(dot(reflect(-keyLight, normal), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);

  vec3 lowColor = vec3(0.235, 0.275, 0.690);
  vec3 highColor = vec3(0.585, 0.630, 0.980);
  vec3 color = mix(lowColor, highColor, 0.25 + diffuse * 0.62 + vSeed * 0.10);

  if (vMaterial > 0.5 && vMaterial < 1.5) {
    color = mix(vec3(0.275, 0.305, 0.740), vec3(0.690, 0.720, 1.0), diffuse * 0.58);
  } else if (vMaterial > 1.5 && vMaterial < 2.5) {
    color = mix(vec3(0.505, 0.400, 0.790), vec3(0.780, 0.670, 1.0), 0.28 + diffuse * 0.58);
  } else if (vMaterial > 2.5) {
    color = mix(vec3(0.025, 0.030, 0.070), vec3(0.300, 0.350, 0.620), specular);
  }

  color += vec3(0.54, 0.63, 1.0) * rim * 0.18;
  color += vec3(1.0) * specular * 0.62;

  float edgeAlpha = smoothstep(1.0, 0.72, radiusSquared);
  float depthFade = smoothstep(4.6, 2.65, vDepth);
  outColor = vec4(color, edgeAlpha * mix(0.76, 0.96, depthFade));
}`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const damp = (current, target, smoothing, deltaSeconds) =>
  current + (target - current) * (1 - Math.exp(-smoothing * deltaSeconds));

function createSeededRandom(initialSeed = 0x6d2b79f5) {
  let seed = initialSeed >>> 0;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleEllipsoid(random, component) {
  let x;
  let y;
  let z;
  do {
    x = random() * 2 - 1;
    y = random() * 2 - 1;
    z = random() * 2 - 1;
  } while (x * x + y * y + z * z > 1);

  const angle = component.rotation || 0;
  const rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
  const rotatedY = x * Math.sin(angle) + y * Math.cos(angle);
  return {
    x: component.center[0] + rotatedX * component.radii[0],
    y: component.center[1] + rotatedY * component.radii[1],
    z: component.center[2] + z * component.radii[2],
    material: component.material,
    seed: random()
  };
}

function createDuckParticleData() {
  const random = createSeededRandom();
  const components = [
    { count: 1530, center: [-0.15, -0.18, 0], radii: [0.82, 0.55, 0.50], material: 0 },
    { count: 300, center: [0.34, -0.05, 0], radii: [0.47, 0.52, 0.43], material: 0 },
    { count: 350, center: [0.42, 0.31, 0], radii: [0.33, 0.49, 0.35], material: 0 },
    { count: 600, center: [0.59, 0.64, 0], radii: [0.42, 0.38, 0.40], material: 0 },
    { count: 100, center: [0.47, 0.84, -0.01], radii: [0.30, 0.18, 0.31], material: 0 },
    { count: 320, center: [1.03, 0.60, 0], radii: [0.43, 0.14, 0.28], rotation: -0.02, material: 2 },
    { count: 480, center: [-0.17, -0.08, 0.43], radii: [0.56, 0.31, 0.12], rotation: -0.14, material: 1 },
    { count: 180, center: [-0.92, 0.00, -0.02], radii: [0.35, 0.20, 0.28], rotation: 0.18, material: 0 },
    { count: 90, center: [-0.38, -0.72, 0.14], radii: [0.23, 0.09, 0.22], material: 2 },
    { count: 90, center: [0.27, -0.72, 0.13], radii: [0.23, 0.09, 0.22], material: 2 },
    { count: 56, center: [0.75, 0.72, 0.37], radii: [0.068, 0.068, 0.050], material: 3 }
  ];

  const particles = [];
  for (const component of components) {
    for (let index = 0; index < component.count; index += 1) {
      particles.push(sampleEllipsoid(random, component));
    }
  }

  // Spatial ordering makes adjacent texture samples useful local neighbors for
  // the cohesion solve without an expensive all-pairs search.
  const spatialKey = (particle) => {
    const x = clamp(Math.floor((particle.x + 1.5) * 12), 0, 63);
    const y = clamp(Math.floor((particle.y + 1.0) * 14), 0, 63);
    const z = clamp(Math.floor((particle.z + 0.7) * 16), 0, 63);
    return x * 4096 + y * 64 + z;
  };
  particles.sort((a, b) => spatialKey(a) - spatialKey(b));

  const home = new Float32Array(PARTICLE_COUNT * 4);
  const positions = new Float32Array(PARTICLE_COUNT * 4);
  const velocities = new Float32Array(PARTICLE_COUNT * 4);

  particles.forEach((particle, index) => {
    const offset = index * 4;
    const packedMaterial = particle.material + 0.02 + particle.seed * 0.96;
    home[offset] = particle.x;
    home[offset + 1] = particle.y;
    home[offset + 2] = particle.z;
    home[offset + 3] = packedMaterial;
    positions[offset] = particle.x;
    positions[offset + 1] = particle.y;
    positions[offset + 2] = particle.z;
    positions[offset + 3] = packedMaterial;
    velocities[offset + 3] = particle.seed;
  });

  return { home, positions, velocities };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;

  const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error';
  gl.deleteShader(shader);
  throw new Error(message);
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  const message = gl.getProgramInfoLog(program) || 'Unknown shader link error';
  gl.deleteProgram(program);
  throw new Error(message);
}

function createFloatTexture(gl, data) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    PARTICLE_TEXTURE_SIZE,
    PARTICLE_TEXTURE_SIZE,
    0,
    gl.RGBA,
    gl.FLOAT,
    data
  );
  return texture;
}

function createSimulationState(gl, positionData, velocityData) {
  const positionTexture = createFloatTexture(gl, positionData);
  const velocityTexture = createFloatTexture(gl, velocityData);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, positionTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velocityTexture, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Floating-point particle framebuffer is unavailable');
  }
  return { positionTexture, velocityTexture, framebuffer };
}

function getUniforms(gl, program, names) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
}

function bindTexture(gl, texture, unit, uniform) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(uniform, unit);
}

function drawFallback(originalCanvas, particleData) {
  let canvas = originalCanvas;
  let context = canvas.getContext('2d');
  if (!context) {
    canvas = originalCanvas.cloneNode();
    originalCanvas.replaceWith(canvas);
    context = canvas.getContext('2d');
  }
  if (!context) return;

  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  context.scale(ratio, ratio);
  context.clearRect(0, 0, rect.width, rect.height);

  const projected = [];
  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const offset = index * 4;
    projected.push({
      x: particleData.home[offset],
      y: particleData.home[offset + 1],
      z: particleData.home[offset + 2],
      material: Math.floor(particleData.home[offset + 3]),
      seed: particleData.home[offset + 3] % 1
    });
  }
  projected.sort((a, b) => a.z - b.z);

  const scale = Math.min(rect.width / 3.05, rect.height / 2.22);
  const centerX = rect.width * 0.48;
  const centerY = rect.height * 0.52;
  for (const particle of projected) {
    const colors = ['#5662d7', '#6974e5', '#9a82e2', '#1e2146'];
    context.globalAlpha = 0.62 + particle.seed * 0.28;
    context.fillStyle = colors[particle.material] || colors[0];
    context.beginPath();
    context.arc(
      centerX + particle.x * scale,
      centerY - particle.y * scale,
      1.15 + particle.seed * 1.05,
      0,
      Math.PI * 2
    );
    context.fill();
  }
  context.globalAlpha = 1;
}

export function mountFluidDuck(canvas) {
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const particleData = createDuckParticleData();
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance'
  });

  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    drawFallback(canvas, particleData);
    return;
  }

  let updateProgram;
  let particleProgram;
  let homeTexture;
  let states;
  try {
    updateProgram = createProgram(gl, FULLSCREEN_VERTEX_SHADER, UPDATE_FRAGMENT_SHADER);
    particleProgram = createProgram(gl, PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER);
    homeTexture = createFloatTexture(gl, particleData.home);
    states = [
      createSimulationState(gl, particleData.positions, particleData.velocities),
      createSimulationState(gl, particleData.positions, particleData.velocities)
    ];
  } catch (error) {
    console.warn('The 3D particle duck could not start.', error);
    drawFallback(canvas, particleData);
    return;
  }

  const updateUniforms = getUniforms(gl, updateProgram, [
    'uPositionTexture',
    'uVelocityTexture',
    'uHomeTexture',
    'uPointer',
    'uPreviousPointer',
    'uPointerVelocity',
    'uPointerActive',
    'uDeltaTime',
    'uTime'
  ]);
  const particleUniforms = getUniforms(gl, particleProgram, [
    'uPositionTexture',
    'uHomeTexture',
    'uResolution',
    'uPixelRatio',
    'uYaw',
    'uPitch'
  ]);

  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);

  const pointer = {
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    targetX: 0,
    targetY: 0,
    velocityX: 0,
    velocityY: 0,
    targetVelocityX: 0,
    targetVelocityY: 0,
    interaction: 0,
    hovering: false,
    lastMove: performance.now()
  };

  let currentState = 0;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  let width = 1;
  let height = 1;
  let visible = true;
  let frameRequest = 0;
  let lastFrame = performance.now();
  let yaw = -0.11;
  let pitch = -0.045;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width * pixelRatio));
    height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    const now = performance.now();
    const elapsed = Math.max(12, now - pointer.lastMove) / 1000;
    const normalizedX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const normalizedY = clamp(1 - ((event.clientY - rect.top) / rect.height) * 2, -1, 1);
    const nextX = normalizedX * 1.48;
    const nextY = normalizedY * 1.02;

    pointer.targetVelocityX = clamp((nextX - pointer.targetX) / elapsed, -5, 5);
    pointer.targetVelocityY = clamp((nextY - pointer.targetY) / elapsed, -5, 5);
    pointer.targetX = nextX;
    pointer.targetY = nextY;
    pointer.lastMove = now;
  };

  const handlePointerEnter = (event) => {
    pointer.hovering = true;
    document.documentElement.classList.add('is-over-fluid');
    updatePointer(event);
  };
  const handlePointerLeave = () => {
    pointer.hovering = false;
    pointer.targetVelocityX = 0;
    pointer.targetVelocityY = 0;
    document.documentElement.classList.remove('is-over-fluid');
  };
  const handlePointerDown = (event) => {
    pointer.interaction = 1;
    updatePointer(event);
  };

  canvas.addEventListener('pointerenter', handlePointerEnter, { passive: true });
  canvas.addEventListener('pointermove', updatePointer, { passive: true });
  canvas.addEventListener('pointerdown', handlePointerDown, { passive: true });
  canvas.addEventListener('pointerleave', handlePointerLeave);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !document.hidden && !frameRequest) {
      lastFrame = performance.now();
      frameRequest = requestAnimationFrame(render);
    }
  }, { rootMargin: '120px' });
  visibilityObserver.observe(canvas);

  const handleVisibility = () => {
    if (!document.hidden && visible && !frameRequest) {
      lastFrame = performance.now();
      frameRequest = requestAnimationFrame(render);
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  const handleContextLost = (event) => {
    event.preventDefault();
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  };
  canvas.addEventListener('webglcontextlost', handleContextLost);

  const render = (now) => {
    frameRequest = 0;
    if (!visible || document.hidden || gl.isContextLost()) return;

    const elapsedMilliseconds = Math.min(33.33, now - lastFrame);
    const deltaSeconds = Math.max(0.001, elapsedMilliseconds / 1000);
    lastFrame = now;

    pointer.previousX = pointer.x;
    pointer.previousY = pointer.y;
    pointer.x = damp(pointer.x, pointer.targetX, 13.0, deltaSeconds);
    pointer.y = damp(pointer.y, pointer.targetY, 13.0, deltaSeconds);
    pointer.velocityX = damp(pointer.velocityX, pointer.targetVelocityX, 10.0, deltaSeconds);
    pointer.velocityY = damp(pointer.velocityY, pointer.targetVelocityY, 10.0, deltaSeconds);
    pointer.targetVelocityX = damp(pointer.targetVelocityX, 0, 6.5, deltaSeconds);
    pointer.targetVelocityY = damp(pointer.targetVelocityY, 0, 6.5, deltaSeconds);
    pointer.interaction = damp(pointer.interaction, pointer.hovering ? 1 : 0, pointer.hovering ? 11 : 2.4, deltaSeconds);

    const idleYaw = -0.11 + Math.sin(now * 0.00016) * 0.045;
    const idlePitch = -0.045 + Math.cos(now * 0.00013) * 0.018;
    yaw = damp(yaw, idleYaw + pointer.x * 0.035, 2.4, deltaSeconds);
    pitch = damp(pitch, idlePitch - pointer.y * 0.018, 2.4, deltaSeconds);

    const nextState = 1 - currentState;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, states[nextState].framebuffer);
    gl.viewport(0, 0, PARTICLE_TEXTURE_SIZE, PARTICLE_TEXTURE_SIZE);
    gl.useProgram(updateProgram);
    bindTexture(gl, states[currentState].positionTexture, 0, updateUniforms.uPositionTexture);
    bindTexture(gl, states[currentState].velocityTexture, 1, updateUniforms.uVelocityTexture);
    bindTexture(gl, homeTexture, 2, updateUniforms.uHomeTexture);
    gl.uniform2f(updateUniforms.uPointer, pointer.x, pointer.y);
    gl.uniform2f(updateUniforms.uPreviousPointer, pointer.previousX, pointer.previousY);
    gl.uniform2f(updateUniforms.uPointerVelocity, pointer.velocityX, pointer.velocityY);
    gl.uniform1f(updateUniforms.uPointerActive, pointer.interaction);
    gl.uniform1f(updateUniforms.uDeltaTime, deltaSeconds);
    gl.uniform1f(updateUniforms.uTime, now / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    currentState = nextState;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(particleProgram);
    bindTexture(gl, states[currentState].positionTexture, 0, particleUniforms.uPositionTexture);
    bindTexture(gl, homeTexture, 1, particleUniforms.uHomeTexture);
    gl.uniform2f(particleUniforms.uResolution, width, height);
    gl.uniform1f(particleUniforms.uPixelRatio, pixelRatio);
    gl.uniform1f(particleUniforms.uYaw, yaw);
    gl.uniform1f(particleUniforms.uPitch, pitch);
    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);

    frameRequest = requestAnimationFrame(render);
  };

  resize();
  frameRequest = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frameRequest);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', handleVisibility);
    canvas.removeEventListener('pointerenter', handlePointerEnter);
    canvas.removeEventListener('pointermove', updatePointer);
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointerleave', handlePointerLeave);
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    document.documentElement.classList.remove('is-over-fluid');

    for (const state of states) {
      gl.deleteTexture(state.positionTexture);
      gl.deleteTexture(state.velocityTexture);
      gl.deleteFramebuffer(state.framebuffer);
    }
    gl.deleteTexture(homeTexture);
    gl.deleteVertexArray(vertexArray);
    gl.deleteProgram(updateProgram);
    gl.deleteProgram(particleProgram);
  };
}
