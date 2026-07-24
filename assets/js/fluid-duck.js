const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform vec2 uPointer;
uniform vec2 uVelocity;
uniform float uTime;
uniform float uInteraction;
uniform float uYaw;
uniform float uPitch;

out vec4 outColor;

const float FAR_CLIP = 8.0;
const int MAX_STEPS = 72;

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(
      mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float sdEllipsoid(vec3 p, vec3 radii) {
  float k0 = length(p / radii);
  float k1 = length(p / (radii * radii));
  return k0 * (k0 - 1.0) / max(k1, 0.0001);
}

float sdRoundBox(vec3 p, vec3 bounds, float radius) {
  vec3 q = abs(p) - bounds + radius;
  return min(max(q.x, max(q.y, q.z)), 0.0) + length(max(q, 0.0)) - radius;
}

float smoothUnion(float a, float b, float radius) {
  float h = clamp(0.5 + 0.5 * (b - a) / radius, 0.0, 1.0);
  return mix(b, a, h) - radius * h * (1.0 - h);
}

vec3 fluidDomain(vec3 p) {
  p.xz = rotate2d(-uYaw) * p.xz;
  p.yz = rotate2d(-uPitch) * p.yz;

  float slowTime = uTime * 0.34;
  float silkA = sin(p.x * 3.1 + p.y * 2.3 - slowTime * 1.4);
  float silkB = sin(p.y * 4.0 - p.z * 2.6 + slowTime);
  float silkC = sin((p.x - p.z) * 3.5 + p.y * 1.8 + slowTime * 0.9);
  p += vec3(silkB, silkA, silkC) * 0.010;

  vec2 pointerWorld = vec2(uPointer.x * 1.42, uPointer.y * 1.12);
  vec2 delta = p.xy - pointerWorld;
  float radius = length(delta);
  float influence = exp(-radius * radius * 4.8) * uInteraction;
  float velocityLength = max(length(uVelocity), 0.0001);
  vec2 direction = uVelocity / velocityLength;

  // A slowly relaxing curl and pressure wake approximates water around 1.8 cP:
  // cohesive enough to read as one volume, but still able to stream like silk.
  p.xy -= direction * influence * 0.105;
  p.xy += vec2(-delta.y, delta.x) * influence * length(uVelocity) * 0.055;
  p.z -= influence * (0.055 + 0.035 * sin(radius * 15.0 - uTime * 2.1));
  return p;
}

vec2 scene(vec3 worldPoint) {
  vec3 p = fluidDomain(worldPoint);

  float body = sdEllipsoid(p - vec3(-0.13, -0.14, 0.0), vec3(0.91, 0.57, 0.55));
  float breast = sdEllipsoid(p - vec3(0.42, -0.02, 0.0), vec3(0.48, 0.57, 0.46));
  float neck = sdEllipsoid(p - vec3(0.43, 0.30, 0.0), vec3(0.36, 0.51, 0.37));
  float head = sdEllipsoid(p - vec3(0.58, 0.61, 0.0), vec3(0.43, 0.39, 0.41));
  float crown = sdEllipsoid(p - vec3(0.48, 0.81, -0.01), vec3(0.30, 0.20, 0.31));
  float tail = sdEllipsoid(p - vec3(-0.93, 0.02, -0.01), vec3(0.38, 0.22, 0.34));

  float bodyVolume = smoothUnion(body, breast, 0.30);
  bodyVolume = smoothUnion(bodyVolume, neck, 0.28);
  bodyVolume = smoothUnion(bodyVolume, head, 0.25);
  bodyVolume = smoothUnion(bodyVolume, crown, 0.18);
  bodyVolume = smoothUnion(bodyVolume, tail, 0.18);

  vec2 result = vec2(bodyVolume, 1.0);

  vec3 wingPoint = p - vec3(-0.18, -0.08, 0.47);
  wingPoint.xy = rotate2d(-0.15) * wingPoint.xy;
  float wing = sdEllipsoid(wingPoint, vec3(0.58, 0.31, 0.13));
  if (wing < result.x) result = vec2(wing, 2.0);

  vec3 billPoint = p - vec3(1.02, 0.57, 0.0);
  billPoint.xy = rotate2d(0.035) * billPoint.xy;
  float bill = sdRoundBox(billPoint, vec3(0.38, 0.145, 0.29), 0.13);
  float billTip = sdEllipsoid(p - vec3(1.30, 0.56, 0.0), vec3(0.22, 0.13, 0.27));
  bill = smoothUnion(bill, billTip, 0.09);
  if (bill < result.x) result = vec2(bill, 3.0);

  float eye = length(p - vec3(0.76, 0.70, 0.355)) - 0.064;
  if (eye < result.x) result = vec2(eye, 4.0);

  float nostril = length(p - vec3(1.12, 0.675, 0.255)) - 0.026;
  if (nostril < result.x) result = vec2(nostril, 4.0);

  return result;
}

vec3 getNormal(vec3 p) {
  const float e = 0.0015;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * scene(p + k.xyy * e).x +
    k.yyx * scene(p + k.yyx * e).x +
    k.yxy * scene(p + k.yxy * e).x +
    k.xxx * scene(p + k.xxx * e).x
  );
}

float softShadow(vec3 origin, vec3 direction) {
  float result = 1.0;
  float distanceAlongRay = 0.035;
  for (int i = 0; i < 14; i++) {
    float distanceToScene = scene(origin + direction * distanceAlongRay).x;
    result = min(result, 13.0 * distanceToScene / distanceAlongRay);
    distanceAlongRay += clamp(distanceToScene, 0.018, 0.16);
    if (distanceAlongRay > 2.6) break;
  }
  return clamp(result, 0.25, 1.0);
}

vec3 materialColor(float material, vec3 point, vec3 normal) {
  float flow = valueNoise(point * 3.5 + vec3(0.0, uTime * 0.15, uTime * 0.08));
  vec3 bodyLow = vec3(0.245, 0.292, 0.780);
  vec3 bodyHigh = vec3(0.500, 0.566, 0.995);
  vec3 color = mix(bodyLow, bodyHigh, 0.34 + flow * 0.36 + normal.y * 0.10);

  if (material > 1.5 && material < 2.5) {
    color = mix(vec3(0.285, 0.330, 0.825), vec3(0.610, 0.660, 1.0), flow * 0.55);
  } else if (material > 2.5 && material < 3.5) {
    color = mix(vec3(0.550, 0.440, 0.900), vec3(0.780, 0.676, 1.0), 0.40 + flow * 0.35);
  } else if (material > 3.5) {
    color = vec3(0.035, 0.038, 0.070);
  }
  return color;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;

  vec3 cameraOrigin = vec3(0.12, 0.28, 4.25);
  vec3 target = vec3(0.10, 0.08, 0.0);
  vec3 forward = normalize(target - cameraOrigin);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  vec3 rayDirection = normalize(forward + uv.x * right * 0.405 + uv.y * up * 0.405);

  float distanceAlongRay = 0.0;
  float material = 0.0;
  bool hit = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 point = cameraOrigin + rayDirection * distanceAlongRay;
    vec2 samplePoint = scene(point);
    if (samplePoint.x < 0.0012) {
      material = samplePoint.y;
      hit = true;
      break;
    }
    distanceAlongRay += samplePoint.x * 0.78;
    if (distanceAlongRay > FAR_CLIP) break;
  }

  if (!hit) {
    outColor = vec4(0.0);
    return;
  }

  vec3 point = cameraOrigin + rayDirection * distanceAlongRay;
  vec3 normal = getNormal(point);
  vec3 viewDirection = normalize(cameraOrigin - point);
  vec3 keyDirection = normalize(vec3(-0.55, 0.88, 0.72));
  vec3 rimDirection = normalize(vec3(0.62, 0.24, 0.75));

  float diffuse = max(dot(normal, keyDirection), 0.0);
  float shadow = softShadow(point + normal * 0.008, keyDirection);
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.6);
  float keySpecular = pow(max(dot(reflect(-keyDirection, normal), viewDirection), 0.0), 74.0);
  float rimSpecular = pow(max(dot(reflect(-rimDirection, normal), viewDirection), 0.0), 34.0);
  float caustic = pow(max(0.0, sin(point.y * 11.0 - point.x * 6.0 + uTime * 0.8)), 10.0);

  vec3 base = materialColor(material, point, normal);
  vec3 color = base * (0.42 + diffuse * shadow * 0.70);
  color += vec3(0.66, 0.74, 1.0) * rim * 0.38;
  color += vec3(1.0) * keySpecular * 0.80;
  color += vec3(0.72, 0.80, 1.0) * rimSpecular * 0.30;
  color += vec3(0.26, 0.32, 0.72) * caustic * 0.05;

  if (material > 3.5) {
    color = mix(color, vec3(0.83, 0.88, 1.0), keySpecular * 0.65);
  }

  float alpha = 0.96;
  outColor = vec4(color, alpha);
}`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const damp = (current, target, smoothing, deltaSeconds) =>
  current + (target - current) * (1 - Math.exp(-smoothing * deltaSeconds));

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;

  const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error';
  gl.deleteShader(shader);
  throw new Error(message);
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
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

function drawFallback(canvas) {
  let targetCanvas = canvas;
  let context = canvas.getContext('2d');
  if (!context) {
    targetCanvas = canvas.cloneNode();
    canvas.replaceWith(targetCanvas);
    context = targetCanvas.getContext('2d');
  }
  if (!context) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = targetCanvas.getBoundingClientRect();
  targetCanvas.width = Math.max(1, Math.round(rect.width * ratio));
  targetCanvas.height = Math.max(1, Math.round(rect.height * ratio));

  context.scale(ratio, ratio);
  const unit = Math.min(rect.width / 3.2, rect.height / 2.5);
  const centerX = rect.width * 0.48;
  const centerY = rect.height * 0.56;
  const fill = context.createLinearGradient(centerX - unit, centerY - unit, centerX + unit, centerY + unit);
  fill.addColorStop(0, '#929cff');
  fill.addColorStop(0.48, '#5965db');
  fill.addColorStop(1, '#343fa7');
  context.fillStyle = fill;

  context.beginPath();
  context.ellipse(centerX - unit * 0.22, centerY + unit * 0.22, unit * 0.88, unit * 0.56, -0.06, 0, Math.PI * 2);
  context.ellipse(centerX + unit * 0.48, centerY - unit * 0.50, unit * 0.41, unit * 0.38, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#a693f4';
  context.beginPath();
  context.ellipse(centerX + unit * 0.94, centerY - unit * 0.46, unit * 0.40, unit * 0.14, 0.03, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#18182d';
  context.beginPath();
  context.arc(centerX + unit * 0.60, centerY - unit * 0.57, unit * 0.055, 0, Math.PI * 2);
  context.fill();
}

export function mountFluidDuck(canvas) {
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance'
  });

  if (!gl) {
    drawFallback(canvas);
    return;
  }

  let program;
  try {
    program = createProgram(gl);
  } catch (error) {
    console.warn('The liquid duck renderer could not start.', error);
    drawFallback(canvas);
    return;
  }

  const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    resolution: gl.getUniformLocation(program, 'uResolution'),
    pointer: gl.getUniformLocation(program, 'uPointer'),
    velocity: gl.getUniformLocation(program, 'uVelocity'),
    time: gl.getUniformLocation(program, 'uTime'),
    interaction: gl.getUniformLocation(program, 'uInteraction'),
    yaw: gl.getUniformLocation(program, 'uYaw'),
    pitch: gl.getUniformLocation(program, 'uPitch')
  };

  const pointer = {
    x: 0,
    y: 0,
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

  let renderScale = Math.min(window.devicePixelRatio || 1, 1.4);
  let width = 0;
  let height = 0;
  let visible = true;
  let frameRequest = 0;
  let lastFrame = performance.now();
  let frameSamples = 0;
  let frameTimeTotal = 0;
  let yaw = -0.08;
  let pitch = -0.035;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width * renderScale));
    height = Math.max(1, Math.round(rect.height * renderScale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    const now = performance.now();
    const elapsed = Math.max(12, now - pointer.lastMove) / 1000;
    const nextX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const nextY = clamp(1 - ((event.clientY - rect.top) / rect.height) * 2, -1, 1);

    pointer.targetVelocityX = clamp((nextX - pointer.targetX) / elapsed, -4, 4);
    pointer.targetVelocityY = clamp((nextY - pointer.targetY) / elapsed, -4, 4);
    pointer.targetX = nextX;
    pointer.targetY = nextY;
    pointer.lastMove = now;
  };

  canvas.addEventListener('pointerenter', (event) => {
    pointer.hovering = true;
    document.documentElement.classList.add('is-over-fluid');
    updatePointer(event);
  }, { passive: true });

  canvas.addEventListener('pointermove', updatePointer, { passive: true });
  canvas.addEventListener('pointerdown', (event) => {
    pointer.interaction = Math.max(pointer.interaction, 0.9);
    updatePointer(event);
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => {
    pointer.hovering = false;
    pointer.targetVelocityX = 0;
    pointer.targetVelocityY = 0;
    document.documentElement.classList.remove('is-over-fluid');
  });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !frameRequest) {
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

  const render = (now) => {
    frameRequest = 0;
    if (!visible || document.hidden) return;

    const frameMilliseconds = Math.min(50, now - lastFrame);
    const deltaSeconds = Math.max(0.001, frameMilliseconds / 1000);
    lastFrame = now;

    pointer.x = damp(pointer.x, pointer.targetX, 9.0, deltaSeconds);
    pointer.y = damp(pointer.y, pointer.targetY, 9.0, deltaSeconds);
    pointer.velocityX = damp(pointer.velocityX, pointer.targetVelocityX, 7.0, deltaSeconds);
    pointer.velocityY = damp(pointer.velocityY, pointer.targetVelocityY, 7.0, deltaSeconds);
    pointer.targetVelocityX = damp(pointer.targetVelocityX, 0, 4.6, deltaSeconds);
    pointer.targetVelocityY = damp(pointer.targetVelocityY, 0, 4.6, deltaSeconds);

    const speed = Math.hypot(pointer.velocityX, pointer.velocityY);
    const targetInteraction = pointer.hovering ? clamp(0.20 + speed * 0.22, 0.20, 1.0) : 0;
    pointer.interaction = damp(pointer.interaction, targetInteraction, pointer.hovering ? 5.0 : 1.75, deltaSeconds);

    const idleYaw = -0.08 + Math.sin(now * 0.00018) * 0.055;
    const idlePitch = -0.035 + Math.cos(now * 0.00015) * 0.025;
    yaw = damp(yaw, idleYaw + pointer.x * 0.12, 2.8, deltaSeconds);
    pitch = damp(pitch, idlePitch - pointer.y * 0.045, 2.8, deltaSeconds);

    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, width, height);
    gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
    gl.uniform2f(uniforms.velocity, pointer.velocityX, pointer.velocityY);
    gl.uniform1f(uniforms.time, now / 1000);
    gl.uniform1f(uniforms.interaction, pointer.interaction);
    gl.uniform1f(uniforms.yaw, yaw);
    gl.uniform1f(uniforms.pitch, pitch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    frameSamples += 1;
    frameTimeTotal += frameMilliseconds;
    if (frameSamples >= 90) {
      const averageFrameTime = frameTimeTotal / frameSamples;
      const targetScale = Math.min(window.devicePixelRatio || 1, 1.4);
      if (averageFrameTime > 22 && renderScale > 1) {
        renderScale = Math.max(1, renderScale - 0.15);
        resize();
      } else if (averageFrameTime < 15.4 && renderScale < targetScale) {
        renderScale = Math.min(targetScale, renderScale + 0.1);
        resize();
      }
      frameSamples = 0;
      frameTimeTotal = 0;
    }

    frameRequest = requestAnimationFrame(render);
  };

  resize();
  frameRequest = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frameRequest);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', handleVisibility);
    document.documentElement.classList.remove('is-over-fluid');
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
}
