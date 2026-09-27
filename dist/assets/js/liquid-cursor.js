/*
 * Liquid cursor effect by aecync — https://aecync.com
 * Adapted for this portfolio with accessibility and lifecycle fallbacks.
 */

const canvas = document.querySelector('#liquid-cursor');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer: fine)');

if (canvas && !reducedMotion.matches && finePointer.matches) {
  setupLiquidCursor(canvas);
}

function setupLiquidCursor(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha:true,
    antialias:false,
    premultipliedAlpha:false
  });

  if (!gl) {
    console.warn('Liquid Cursor: WebGL is not supported in this browser.');
    canvas.remove();
    return;
  }

  const MAX_BLOBS = 96;
  const settings = {
    color:[75 / 255, 87 / 255, 209 / 255, 1],
    threshold:1,
    mainRadius:20,
    mainBlobCount:7,
    blobOrbitRadius:14,
    blobWobbleSpeed:4,
    maxTrailBlobs:42,
    trailSpacing:7,
    trailLife:.45,
    trailStartRadius:22,
    trailEndRadius:4,
    maxSplats:40,
    splatMinSpeed:850,
    splatInterval:.035,
    splatMinRadius:5,
    splatMaxRadius:13,
    splatLife:.65,
    splatScatter:35,
    splatDrift:80,
    followSpeed:24,
    // Over a target the blob stops being decoration and becomes an aiming
    // device: it drops the wobble, the trail and the smear, and chases the
    // pointer hard enough to sit on it.
    calmFollowSpeed:76,
    calmSpeed:11
  };

  let dpr = Math.min(devicePixelRatio || 1, 2);
  let mouse = { x:innerWidth * dpr / 2, y:innerHeight * dpr / 2 };
  let current = { ...mouse };
  let previous = { ...current };
  let velocityDir = { x:1, y:0 };
  let speed = 0;
  let trail = [];
  let splats = [];
  let trailDistance = 0;
  let splatTimer = 0;
  let lastTime = performance.now();
  let active = false;
  let cursorScale = 1;
  let tone = '';
  let driven = false;
  let calm = 0, calmTarget = 0;

  const vertexSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // A hard `field > threshold` cut aliases the silhouette to whole pixels, so a
  // one-pixel move makes the whole edge crawl. Resolve the isosurface with a
  // smoothstep one pixel wide instead — derivatives when the driver has them,
  // a fixed band scaled by the field's own slope otherwise.
  const derivatives = gl.getExtension('OES_standard_derivatives');
  const fragmentSource = `${derivatives ? '#extension GL_OES_standard_derivatives : enable\n' : ''}
    precision mediump float;
    #define MAX_BLOBS 96
    uniform vec4 u_color;
    uniform float u_threshold;
    uniform int u_blobCount;
    uniform vec4 u_blobs[MAX_BLOBS];

    void main() {
      vec2 pixel = gl_FragCoord.xy;
      float field = 0.0;

      for (int i = 0; i < MAX_BLOBS; i++) {
        if (i >= u_blobCount) break;
        vec2 pos = u_blobs[i].xy;
        float radius = u_blobs[i].z;
        float strength = u_blobs[i].w;
        float d = distance(pixel, pos);
        field += (radius * radius * strength) / max(d * d, 0.001);
      }

      // keep the interior finite so the edge width below never sees an infinity
      field = min(field, u_threshold * 8.0);
      ${derivatives
        ? 'float edge = max(fwidth(field), 0.0001);'
        : 'float edge = u_threshold * 0.22;'}
      float alpha = smoothstep(u_threshold - edge, u_threshold + edge, field);
      gl_FragColor = vec4(u_color.rgb, u_color.a * alpha);
    }
  `;

  const makeShader = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.error('Liquid Cursor shader error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  };

  const vertexShader = makeShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = makeShader(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    canvas.remove();
    return;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Liquid Cursor program error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    canvas.remove();
    return;
  }

  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    color:gl.getUniformLocation(program, 'u_color'),
    threshold:gl.getUniformLocation(program, 'u_threshold'),
    count:gl.getUniformLocation(program, 'u_blobCount'),
    blobs:gl.getUniformLocation(program, 'u_blobs')
  };
  const blobData = new Float32Array(MAX_BLOBS * 4);

  const px = (value) => value * dpr;
  const rand = (min, max) => min + Math.random() * (max - min);
  // Damped to its own mean rather than to 1, so calming the breath changes the
  // shape's stability without changing how big it reads.
  const pulse = (index, time, amount) => .85 + Math.sin(time + index * 3.1) * .12 * amount;

  const resize = () => {
    const oldDpr = dpr;
    dpr = Math.min(devicePixelRatio || 1, 2);
    const ratio = dpr / oldDpr;
    mouse.x *= ratio;
    mouse.y *= ratio;
    current.x *= ratio;
    current.y *= ratio;
    previous.x *= ratio;
    previous.y *= ratio;
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const wake = (event) => {
    // Once the cursor lens is driving us, it owns the position: it hands over an
    // already-sprung point that lags the pointer (and parks off it entirely on a
    // stuck element). Writing the raw pointer here too made the two fight frame
    // by frame — invisible on a fast sweep, pure jitter on a small one.
    if (!driven) {
      mouse.x = event.clientX * dpr;
      mouse.y = (innerHeight - event.clientY) * dpr;
    }
    if (active) return;
    active = true;
    current = { ...mouse };
    previous = { ...mouse };
    trail = [];
    splats = [];
    document.documentElement.classList.add('liquid-cursor-active');
    canvas.classList.add('is-visible');
  };

  const sleep = () => {
    active = false;
    trail = [];
    splats = [];
    document.documentElement.classList.remove('liquid-cursor-active');
    canvas.classList.remove('is-visible');
  };

  // Over anything interactive the disc cuts instead of covering: it paints white
  // under a difference blend, so the title, icon or photograph underneath comes
  // back as its own high-contrast negative rather than being buried. This is what
  // the project index has always done; every tone now does it. Only the idle
  // cursor, over nothing clickable, keeps the solid house colour.
  const CUT = [1, 1, 1, 1];

  window.liquidCursor = {
    setState(state) {
      driven = true;
      mouse.x = state.x * dpr;
      mouse.y = (innerHeight - state.y) * dpr;
      cursorScale = Math.max(.4, Number(state.scale) || 1);
      calmTarget = state.precise ? 1 : 0;
      tone = state.tone || '';
      canvas.classList.toggle('is-cut', Boolean(tone));
    }
  };

  const update = (dt, time) => {
    calm += (calmTarget - calm) * (1 - Math.exp(-settings.calmSpeed * dt));
    const followSpeed = settings.followSpeed + (settings.calmFollowSpeed - settings.followSpeed) * calm;
    const follow = 1 - Math.exp(-followSpeed * dt);
    current.x += (mouse.x - current.x) * follow;
    current.y += (mouse.y - current.y) * follow;

    const movementX = current.x - previous.x;
    const movementY = current.y - previous.y;
    const distance = Math.hypot(movementX, movementY);

    // Per-frame velocity is noisy — a 125Hz mouse feeding a 60Hz frame delivers
    // its movement in uneven bites — and both the stretch and the trailing blobs
    // are hung off it. Low-pass the magnitude and ease the direction, and ignore
    // the direction of sub-pixel steps entirely, where it is mostly rounding.
    const instant = distance / Math.max(dt, .0001);
    speed += (instant - speed) * (1 - Math.exp(-14 * dt));

    if (distance > px(.4)) {
      const turn = 1 - Math.exp(-16 * dt);
      velocityDir.x += (movementX / distance - velocityDir.x) * turn;
      velocityDir.y += (movementY / distance - velocityDir.y) * turn;
      const length = Math.hypot(velocityDir.x, velocityDir.y) || 1;
      velocityDir.x /= length;
      velocityDir.y /= length;
    }

    // The trail follows everywhere, targets included: it sits behind the pointer,
    // never over what is about to be clicked, and the dot marks the hit point
    // regardless. The splats are the ones that get suppressed on a target —
    // they fling ink up to 35px off-axis, which is mess next to something you
    // are trying to hit.
    trailDistance += distance;
    if (trailDistance >= px(settings.trailSpacing)) {
      trailDistance = 0;
      trail.push({ x:current.x, y:current.y, time });
    }
    trail = trail.filter((point) => time - point.time <= settings.trailLife);
    while (trail.length > settings.maxTrailBlobs) trail.shift();

    splatTimer += dt;
    if (calm < .5 && speed > px(settings.splatMinSpeed) && splatTimer >= settings.splatInterval) {
      splatTimer = 0;
      const side = { x:-velocityDir.y, y:velocityDir.x };
      splats.push({
        x:current.x - velocityDir.x * px(rand(15, 45)) + side.x * px(rand(-settings.splatScatter, settings.splatScatter)),
        y:current.y - velocityDir.y * px(rand(15, 45)) + side.y * px(rand(-settings.splatScatter, settings.splatScatter)),
        vx:-velocityDir.x * px(rand(settings.splatDrift * .4, settings.splatDrift)) + side.x * px(rand(-settings.splatDrift, settings.splatDrift) * .5),
        vy:-velocityDir.y * px(rand(settings.splatDrift * .4, settings.splatDrift)) + side.y * px(rand(-settings.splatDrift, settings.splatDrift) * .5),
        radius:px(rand(settings.splatMinRadius, settings.splatMaxRadius)),
        time
      });
    }

    splats.forEach((splat) => {
      splat.x += splat.vx * dt;
      splat.y += splat.vy * dt;
    });
    splats = splats.filter((splat) => time - splat.time <= settings.splatLife);
    while (splats.length > settings.maxSplats) splats.shift();
    previous.x = current.x;
    previous.y = current.y;
  };

  const render = (timeMilliseconds) => {
    const time = timeMilliseconds / 1000;
    const dt = Math.min((timeMilliseconds - lastTime) / 1000, .033);
    lastTime = timeMilliseconds;

    if (!active) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      requestAnimationFrame(render);
      return;
    }

    update(dt, time);
    let count = 0;
    // Collapsing the seven blobs onto one point does not shrink the silhouette:
    // the merged radius is set by the summed field, which is the same whether
    // they are stacked or spread. It only takes the boil off the boundary.
    const wobble = 1 - calm;
    const stretch = Math.min(speed * .018, px(36)) * wobble;
    // Seven overlapping metaballs read much larger than a single CSS circle.
    // This keeps the liquid silhouette in the old ring's visual footprint while
    // preserving the cursor engine's hover-scale changes.
    const visualScale = cursorScale * .4;

    for (let index = 0; index < settings.mainBlobCount && count < MAX_BLOBS; index++) {
      const phase = time * settings.blobWobbleSpeed + index * 10.17;
      const amount = index / Math.max(1, settings.mainBlobCount - 1);
      const orbit = px(settings.blobOrbitRadius * visualScale) * wobble;
      blobData[count * 4] = current.x + Math.sin(phase * 1.2) * orbit - velocityDir.x * stretch * amount;
      blobData[count * 4 + 1] = current.y + Math.cos(phase * 1.7) * orbit - velocityDir.y * stretch * amount;
      blobData[count * 4 + 2] = px(settings.mainRadius * visualScale) * pulse(index, phase, wobble);
      blobData[count * 4 + 3] = 1;
      count++;
    }

    trail.forEach((point) => {
      if (count >= MAX_BLOBS) return;
      const age = Math.min((time - point.time) / settings.trailLife, 1);
      blobData[count * 4] = point.x;
      blobData[count * 4 + 1] = point.y;
      blobData[count * 4 + 2] = px((settings.trailStartRadius * (1 - age) + settings.trailEndRadius * age) * visualScale);
      blobData[count * 4 + 3] = .85 * (1 - age);
      count++;
    });

    splats.forEach((splat) => {
      if (count >= MAX_BLOBS) return;
      const age = Math.min((time - splat.time) / settings.splatLife, 1);
      blobData[count * 4] = splat.x;
      blobData[count * 4 + 1] = splat.y;
      blobData[count * 4 + 2] = splat.radius * visualScale * (1 + .45 * age);
      blobData[count * 4 + 3] = .7 * (1 - age);
      count++;
    });

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform4fv(uniforms.color, tone ? CUT : settings.color);
    gl.uniform1f(uniforms.threshold, settings.threshold);
    gl.uniform1i(uniforms.count, count);
    gl.uniform4fv(uniforms.blobs, blobData);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
  };

  resize();
  addEventListener('resize', resize, { passive:true });
  addEventListener('pointermove', wake, { passive:true });
  addEventListener('blur', sleep);
  document.addEventListener('mouseleave', sleep);
  document.addEventListener('visibilitychange', () => { if (document.hidden) sleep(); });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    sleep();
  });
  requestAnimationFrame(render);
}
