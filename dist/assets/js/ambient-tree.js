const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const damp = (current, target, smoothing, deltaSeconds) =>
  current + (target - current) * (1 - Math.exp(-smoothing * deltaSeconds));

function createSeededRandom(initialSeed = 0x4f1bbcdc) {
  let seed = initialSeed >>> 0;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createCanopyLeaves() {
  const random = createSeededRandom();
  const colors = ['#5f7659', '#738665', '#879672', '#9aa17d', '#506a50'];
  const clusters = [
    { x: -135, y: -235, rx: 74, ry: 53, count: 19 },
    { x: -78, y: -302, rx: 72, ry: 49, count: 21 },
    { x: -10, y: -276, rx: 68, ry: 51, count: 18 },
    { x: 48, y: -218, rx: 57, ry: 45, count: 13 },
    { x: -80, y: -177, rx: 62, ry: 43, count: 15 }
  ];

  return clusters.flatMap((cluster) => Array.from({ length: cluster.count }, () => {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random());
    return {
      localX: cluster.x + Math.cos(angle) * cluster.rx * radius,
      localY: cluster.y + Math.sin(angle) * cluster.ry * radius,
      radius: 3.4 + random() * 2.4,
      rotation: random() * Math.PI,
      seed: random(),
      color: colors[Math.floor(random() * colors.length)],
      active: true,
      regrowAt: 0
    };
  }));
}

function resolveCircleRectangle(leaf, rectangle) {
  const closestX = clamp(leaf.x, rectangle.left, rectangle.right);
  const closestY = clamp(leaf.y, rectangle.top, rectangle.bottom);
  let deltaX = leaf.x - closestX;
  let deltaY = leaf.y - closestY;
  let distanceSquared = deltaX * deltaX + deltaY * deltaY;
  const radius = leaf.radius;

  if (distanceSquared >= radius * radius) return;

  let normalX;
  let normalY;
  let penetration;
  if (distanceSquared > 0.0001) {
    const distance = Math.sqrt(distanceSquared);
    normalX = deltaX / distance;
    normalY = deltaY / distance;
    penetration = radius - distance;
  } else {
    const distances = [
      { value: Math.abs(leaf.x - rectangle.left), x: -1, y: 0 },
      { value: Math.abs(rectangle.right - leaf.x), x: 1, y: 0 },
      { value: Math.abs(leaf.y - rectangle.top), x: 0, y: -1 },
      { value: Math.abs(rectangle.bottom - leaf.y), x: 0, y: 1 }
    ].sort((a, b) => a.value - b.value);
    normalX = distances[0].x;
    normalY = distances[0].y;
    penetration = radius + distances[0].value;
  }

  leaf.x += normalX * penetration;
  leaf.y += normalY * penetration;
  const velocityAlongNormal = leaf.vx * normalX + leaf.vy * normalY;
  if (velocityAlongNormal < 0) {
    const restitution = 0.13;
    leaf.vx -= velocityAlongNormal * normalX * (1 + restitution);
    leaf.vy -= velocityAlongNormal * normalY * (1 + restitution);
  }

  if (normalY < -0.65) {
    leaf.vx *= 0.965;
    leaf.angularVelocity *= 0.92;
    if (Math.abs(leaf.vy) < 8) leaf.vy = 0;
  }
}

function resolveLeafPairs(leaves) {
  const cellSize = 15;
  const grid = new Map();

  leaves.forEach((leaf, index) => {
    const cellX = Math.floor(leaf.x / cellSize);
    const cellY = Math.floor(leaf.y / cellSize);
    const key = `${cellX}:${cellY}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(index);
  });

  leaves.forEach((leaf, index) => {
    const cellX = Math.floor(leaf.x / cellSize);
    const cellY = Math.floor(leaf.y / cellSize);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const neighbors = grid.get(`${cellX + offsetX}:${cellY + offsetY}`);
        if (!neighbors) continue;
        for (const neighborIndex of neighbors) {
          if (neighborIndex <= index) continue;
          const neighbor = leaves[neighborIndex];
          let deltaX = neighbor.x - leaf.x;
          let deltaY = neighbor.y - leaf.y;
          const minimumDistance = (leaf.radius + neighbor.radius) * 0.78;
          const distanceSquared = deltaX * deltaX + deltaY * deltaY;
          if (distanceSquared >= minimumDistance * minimumDistance) continue;

          const distance = Math.max(Math.sqrt(distanceSquared), 0.01);
          const normalX = deltaX / distance;
          const normalY = deltaY / distance;
          const correction = (minimumDistance - distance) * 0.5;
          leaf.x -= normalX * correction;
          leaf.y -= normalY * correction;
          neighbor.x += normalX * correction;
          neighbor.y += normalY * correction;

          const relativeVelocityX = neighbor.vx - leaf.vx;
          const relativeVelocityY = neighbor.vy - leaf.vy;
          const velocityAlongNormal = relativeVelocityX * normalX + relativeVelocityY * normalY;
          if (velocityAlongNormal < 0) {
            const impulse = velocityAlongNormal * 0.26;
            leaf.vx += normalX * impulse;
            leaf.vy += normalY * impulse;
            neighbor.vx -= normalX * impulse;
            neighbor.vy -= normalY * impulse;
          }
        }
      }
    }
  });
}

export function mountAmbientTree(canvas) {
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const context = canvas.getContext('2d');
  const scene = canvas.closest('.signals');
  if (!context || !scene) return;

  const random = createSeededRandom(0x1a57c0de);
  const attachedLeaves = createCanopyLeaves();
  const fallingLeaves = [];
  const pointer = {
    x: -1000,
    y: -1000,
    vx: 0,
    vy: 0,
    active: false,
    lastMove: performance.now()
  };

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let groundY = 1;
  let baseX = 1;
  let trunkBaseY = 1;
  let treeScale = 1;
  let platforms = [];
  let shake = 0;
  let dropAccumulator = 0;
  let lastFrame = performance.now();
  let frameRequest = 0;
  let visible = true;

  const treePoint = (localX, localY, sway, seed = 0.5) => {
    const heightInfluence = Math.pow(clamp(-localY / 330, 0, 1), 1.55);
    return {
      x: baseX + localX * treeScale + sway * heightInfluence * (0.82 + seed * 0.32),
      y: trunkBaseY + localY * treeScale + Math.abs(sway) * heightInfluence * 0.035
    };
  };

  const updatePlatforms = () => {
    const canvasRectangle = canvas.getBoundingClientRect();
    platforms = [...scene.querySelectorAll('.signal')].map((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        left: rectangle.left - canvasRectangle.left,
        right: rectangle.right - canvasRectangle.left,
        top: rectangle.top - canvasRectangle.top,
        bottom: rectangle.bottom - canvasRectangle.top
      };
    });
  };

  const resize = () => {
    const oldWidth = width;
    const oldHeight = height;
    const rectangle = canvas.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, rectangle.width);
    height = Math.max(1, rectangle.height);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    if (oldWidth > 1 && oldHeight > 1) {
      const scaleX = width / oldWidth;
      const scaleY = height / oldHeight;
      for (const leaf of fallingLeaves) {
        leaf.x *= scaleX;
        leaf.y *= scaleY;
      }
    }

    groundY = height - 5;
    baseX = clamp(width * 0.84, width - 154, width - 82);
    trunkBaseY = groundY - 45;
    treeScale = clamp(width / 820, 0.82, 1.07);
    updatePlatforms();
  };

  const attachedPosition = (leaf, sway) =>
    treePoint(leaf.localX, leaf.localY, sway, leaf.seed);

  const detachLeaf = (leaf, now, sway) => {
    if (!leaf?.active || fallingLeaves.length >= 120) return;
    const position = attachedPosition(leaf, sway);
    leaf.active = false;
    leaf.regrowAt = now + 11000 + random() * 10000;
    fallingLeaves.push({
      x: position.x,
      y: position.y,
      vx: pointer.vx * 0.038 + (random() - 0.5) * 42 + sway * 1.4,
      vy: -12 + random() * 30 + Math.abs(pointer.vy) * 0.016,
      radius: leaf.radius * treeScale,
      rotation: leaf.rotation,
      angularVelocity: (random() - 0.5) * 5.2,
      color: leaf.color,
      seed: leaf.seed,
      bornAt: now,
      alpha: 1
    });
  };

  const shedLeaves = (now, deltaSeconds, sway, canopyHovered) => {
    if (!canopyHovered || fallingLeaves.length >= 120) return;
    dropAccumulator += shake * deltaSeconds * 7.4;
    while (dropAccumulator >= 1) {
      dropAccumulator -= 1;
      const candidates = attachedLeaves.filter((leaf) => leaf.active);
      if (!candidates.length) break;
      detachLeaf(candidates[Math.floor(random() * candidates.length)], now, sway);
    }
  };

  const potRectangle = () => ({
    left: baseX - 29 * treeScale,
    right: baseX + 29 * treeScale,
    top: groundY - 49 * treeScale,
    bottom: groundY
  });

  const resolveStaticCollisions = (leaf) => {
    for (const platform of platforms) resolveCircleRectangle(leaf, platform);
    resolveCircleRectangle(leaf, potRectangle());

    if (leaf.y + leaf.radius > groundY) {
      leaf.y = groundY - leaf.radius;
      if (leaf.vy > 0) leaf.vy *= -0.12;
      leaf.vx *= 0.91;
      leaf.angularVelocity *= 0.86;
      if (Math.abs(leaf.vy) < 7) leaf.vy = 0;
      if (Math.abs(leaf.vx) < 1.2) leaf.vx = 0;
    }
  };

  const integrateLeaf = (leaf, deltaSeconds, now) => {
    leaf.vy += 330 * deltaSeconds;
    const airborne = leaf.y + leaf.radius < groundY - 2;
    if (airborne) leaf.vx += Math.sin(now * 0.0011 + leaf.seed * 9) * 5.2 * deltaSeconds;

    if (pointer.active) {
      const deltaX = leaf.x - pointer.x;
      const deltaY = leaf.y - pointer.y;
      const distance = Math.hypot(deltaX, deltaY);
      const radius = 92;
      if (distance < radius) {
        const falloff = (1 - distance / radius) ** 2;
        const inverseDistance = 1 / Math.max(distance, 7);
        const force = 1420 * falloff;
        leaf.vx += deltaX * inverseDistance * force * deltaSeconds + pointer.vx * falloff * 0.018;
        leaf.vy += deltaY * inverseDistance * force * deltaSeconds + pointer.vy * falloff * 0.018;
        leaf.angularVelocity += (pointer.vx * deltaY - pointer.vy * deltaX) * falloff * 0.00028;
      }
    }

    leaf.vx *= Math.exp(-0.30 * deltaSeconds);
    leaf.vy *= Math.exp(-0.06 * deltaSeconds);
    leaf.x += leaf.vx * deltaSeconds;
    leaf.y += leaf.vy * deltaSeconds;
    leaf.rotation += leaf.angularVelocity * deltaSeconds;

    resolveStaticCollisions(leaf);

    if (leaf.x - leaf.radius < 0) {
      leaf.x = leaf.radius;
      leaf.vx = Math.abs(leaf.vx) * 0.22;
    } else if (leaf.x + leaf.radius > width) {
      leaf.x = width - leaf.radius;
      leaf.vx = -Math.abs(leaf.vx) * 0.22;
    }

    const age = now - leaf.bornAt;
    leaf.alpha = age > 25000 ? clamp(1 - (age - 25000) / 4000, 0, 1) : 1;
  };

  const nearestSurfaceBelow = (leaf) => {
    let surfaceY = groundY;
    for (const platform of platforms) {
      if (leaf.x >= platform.left - leaf.radius && leaf.x <= platform.right + leaf.radius &&
          platform.top >= leaf.y && platform.top < surfaceY) {
        surfaceY = platform.top;
      }
    }
    const pot = potRectangle();
    if (leaf.x >= pot.left && leaf.x <= pot.right && pot.top >= leaf.y && pot.top < surfaceY) {
      surfaceY = pot.top;
    }
    return surfaceY;
  };

  const drawLeaf = (x, y, radius, rotation, color, alpha = 1) => {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.beginPath();
    context.ellipse(0, 0, radius * 1.34, radius * 0.72, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(48,67,45,.24)';
    context.lineWidth = 0.65;
    context.beginPath();
    context.moveTo(-radius * 0.78, 0);
    context.lineTo(radius * 0.82, 0);
    context.stroke();
    context.restore();
  };

  const drawBranch = (start, control, end, widthValue, sway, shade = '#75695c') => {
    const startPoint = treePoint(start[0], start[1], sway, 0.45);
    const controlPoint = treePoint(control[0], control[1], sway, 0.6);
    const endPoint = treePoint(end[0], end[1], sway, 0.78);
    context.strokeStyle = shade;
    context.lineWidth = widthValue * treeScale;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(startPoint.x, startPoint.y);
    context.quadraticCurveTo(controlPoint.x, controlPoint.y, endPoint.x, endPoint.y);
    context.stroke();
  };

  const drawTree = (now, sway) => {
    context.save();
    context.globalAlpha = 0.96;
    drawBranch([0, 0], [-7, -118], [-28, -308], 12, sway, '#75685b');
    drawBranch([-9, -78], [-64, -125], [-120, -184], 7.5, sway);
    drawBranch([-18, -126], [42, -161], [57, -218], 7, sway, '#6f6458');
    drawBranch([-22, -176], [-84, -214], [-145, -247], 6.4, sway);
    drawBranch([-26, -220], [18, -260], [18, -286], 5.5, sway);
    drawBranch([-28, -250], [-66, -282], [-79, -313], 4.7, sway);
    drawBranch([-78, -149], [-112, -178], [-149, -205], 4.2, sway);
    drawBranch([14, -182], [48, -201], [74, -224], 4, sway);
    context.restore();

    for (const leaf of attachedLeaves) {
      if (!leaf.active) continue;
      const position = attachedPosition(leaf, sway);
      const flutter = Math.sin(now * 0.002 + leaf.seed * 14) * 0.12;
      drawLeaf(
        position.x,
        position.y,
        leaf.radius * treeScale,
        leaf.rotation + flutter + sway * 0.012,
        leaf.color,
        0.92
      );
    }
  };

  const drawShadows = () => {
    context.save();
    for (const leaf of fallingLeaves) {
      const surfaceY = nearestSurfaceBelow(leaf);
      const heightAboveSurface = surfaceY - (leaf.y + leaf.radius);
      if (heightAboveSurface < 0 || heightAboveSurface > 76) continue;
      const proximity = 1 - heightAboveSurface / 76;
      context.globalAlpha = leaf.alpha * proximity * 0.17;
      context.fillStyle = '#242720';
      context.filter = `blur(${1.5 + (1 - proximity) * 3}px)`;
      context.beginPath();
      context.ellipse(
        leaf.x + heightAboveSurface * 0.035,
        surfaceY - 1,
        leaf.radius * (0.7 + proximity * 0.52),
        leaf.radius * 0.32,
        0,
        0,
        Math.PI * 2
      );
      context.fill();
    }
    context.restore();
  };

  const drawPot = () => {
    const scale = treeScale;
    const potTop = groundY - 48 * scale;
    context.save();
    context.fillStyle = '#b8997f';
    context.beginPath();
    context.moveTo(baseX - 27 * scale, potTop + 7 * scale);
    context.lineTo(baseX + 27 * scale, potTop + 7 * scale);
    context.lineTo(baseX + 20 * scale, groundY - 2 * scale);
    context.quadraticCurveTo(baseX, groundY + 2 * scale, baseX - 20 * scale, groundY - 2 * scale);
    context.closePath();
    context.fill();

    const gradient = context.createLinearGradient(baseX - 28 * scale, 0, baseX + 28 * scale, 0);
    gradient.addColorStop(0, '#a98770');
    gradient.addColorStop(0.48, '#c4aa91');
    gradient.addColorStop(1, '#987863');
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(baseX - 31 * scale, potTop, 62 * scale, 13 * scale, 5 * scale);
    context.fill();
    context.strokeStyle = 'rgba(91,70,56,.24)';
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  };

  const draw = (now, sway) => {
    context.clearRect(0, 0, width, height);

    context.save();
    context.globalAlpha = 0.16;
    context.fillStyle = '#3a362f';
    context.filter = 'blur(6px)';
    context.beginPath();
    context.ellipse(baseX + 3 * treeScale, groundY - 1, 39 * treeScale, 7 * treeScale, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    drawTree(now, sway);
    drawShadows();
    for (const leaf of fallingLeaves) {
      drawLeaf(leaf.x, leaf.y, leaf.radius, leaf.rotation, leaf.color, leaf.alpha);
    }
    drawPot();
  };

  const handlePointerMove = (event) => {
    const rectangle = canvas.getBoundingClientRect();
    const now = performance.now();
    const nextX = event.clientX - rectangle.left;
    const nextY = event.clientY - rectangle.top;
    const active = nextX >= 0 && nextX <= rectangle.width && nextY >= 0 && nextY <= rectangle.height;
    const elapsed = Math.max(12, now - pointer.lastMove) / 1000;
    if (pointer.active && active) {
      pointer.vx = clamp((nextX - pointer.x) / elapsed, -1500, 1500);
      pointer.vy = clamp((nextY - pointer.y) / elapsed, -1500, 1500);
    }
    pointer.x = nextX;
    pointer.y = nextY;
    pointer.active = active;
    pointer.lastMove = now;
  };

  const handleBlur = () => {
    pointer.active = false;
    pointer.vx = 0;
    pointer.vy = 0;
  };
  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('blur', handleBlur);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(scene);
  for (const platform of scene.querySelectorAll('.signal')) resizeObserver.observe(platform);

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !document.hidden && !frameRequest) {
      lastFrame = performance.now();
      frameRequest = requestAnimationFrame(tick);
    }
  }, { rootMargin: '140px' });
  visibilityObserver.observe(scene);

  const handleVisibility = () => {
    if (!document.hidden && visible && !frameRequest) {
      lastFrame = performance.now();
      frameRequest = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  const tick = (now) => {
    frameRequest = 0;
    if (!visible || document.hidden) return;

    const deltaSeconds = Math.max(0.001, Math.min(1 / 30, (now - lastFrame) / 1000));
    lastFrame = now;
    if (now - pointer.lastMove > 70) {
      pointer.vx = damp(pointer.vx, 0, 9, deltaSeconds);
      pointer.vy = damp(pointer.vy, 0, 9, deltaSeconds);
    }

    const canopyCenter = treePoint(-52, -248, 0);
    const canopyX = (pointer.x - canopyCenter.x) / (180 * treeScale);
    const canopyY = (pointer.y - canopyCenter.y) / (135 * treeScale);
    const canopyHovered = pointer.active && canopyX * canopyX + canopyY * canopyY <= 1;
    const pointerSpeed = Math.hypot(pointer.vx, pointer.vy);
    const targetShake = canopyHovered ? clamp(0.20 + pointerSpeed / 850, 0.20, 1) : 0;
    shake = damp(shake, targetShake, canopyHovered ? 8.5 : 3.2, deltaSeconds);
    const sway = Math.sin(now * 0.00105) * 1.7 +
      Math.sin(now * 0.030 + 0.8) * shake * 5.6 +
      pointer.vx * shake * 0.0022;

    for (const leaf of attachedLeaves) {
      if (!leaf.active && now >= leaf.regrowAt) leaf.active = true;
    }
    shedLeaves(now, deltaSeconds, sway, canopyHovered);

    const substeps = 2;
    const step = deltaSeconds / substeps;
    for (let substep = 0; substep < substeps; substep += 1) {
      for (const leaf of fallingLeaves) integrateLeaf(leaf, step, now);
      resolveLeafPairs(fallingLeaves);
      for (const leaf of fallingLeaves) resolveStaticCollisions(leaf);
    }

    for (let index = fallingLeaves.length - 1; index >= 0; index -= 1) {
      if (fallingLeaves[index].alpha <= 0) fallingLeaves.splice(index, 1);
    }

    draw(now, sway);
    frameRequest = requestAnimationFrame(tick);
  };

  resize();
  frameRequest = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frameRequest);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('blur', handleBlur);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}
