import type { HeatmapData, ViewRange } from './types';

// Unit quad: (0,0)=bottom-left, (1,0)=bottom-right, (1,1)=top-right, (0,1)=top-left
// a_pos.x: [0,1] → maps to [price - halfWidth, price + halfWidth]
// a_pos.y: [0,1] → maps to [yOffset, yOffset + size]

const VERT_SRC = `#version 300 es
precision highp float;

in vec2 a_pos;

// Per-instance attributes
in float a_price;
in float a_yOffset;
in float a_size;
in float a_side;
in float a_brightness;
in vec4 a_highlightColor;

uniform vec2 u_rangeX;       // priceMin, priceMax
uniform vec2 u_rangeY;       // yMin, yMax
uniform float u_barHalfWidth; // in NDC units

out float v_brightness;
out float v_side;
out vec4 v_highlightColor;

void main() {
  // Map price to NDC x center
  float nxCenter = 2.0 * (a_price - u_rangeX.x) / (u_rangeX.y - u_rangeX.x) - 1.0;
  float nx = nxCenter + (a_pos.x - 0.5) * u_barHalfWidth * 2.0;

  // Map y position: yOffset at bottom, yOffset+size at top
  float dataY = a_yOffset + a_pos.y * a_size;
  float ny = 2.0 * (dataY - u_rangeY.x) / (u_rangeY.y - u_rangeY.x) - 1.0;

  gl_Position = vec4(nx, ny, 0.0, 1.0);

  v_brightness = a_brightness;
  v_side = a_side;
  v_highlightColor = a_highlightColor;
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in float v_brightness;
in float v_side;
in vec4 v_highlightColor;
uniform float u_brightnessMin;
uniform float u_brightnessMax;

out vec4 fragColor;

void main() {
  vec3 bidColor = vec3(0.0, 0.78, 0.325);  // #00c853
  vec3 askColor = vec3(1.0, 0.09, 0.27);   // #ff1744
  vec3 defaultColor = mix(bidColor, askColor, v_side);
  vec3 baseColor = mix(defaultColor, v_highlightColor.rgb, v_highlightColor.a);

  // Remap brightness to visible range for maximum contrast when zoomed in
  float bRange = u_brightnessMax - u_brightnessMin;
  float normB = bRange > 1e-6
    ? clamp((v_brightness - u_brightnessMin) / bRange, 0.0, 1.0)
    : 0.5;
  float b = mix(0.6, 1.0, normB);
  vec3 color = baseColor * b;

  fragColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    throw new Error(`Program link error: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export type HeatmapGL = {
  render(range: ViewRange, brightnessMin: number, brightnessMax: number): void;
  resize(width: number, height: number): void;
  updateHighlights(buffer: Float32Array): void;
  updateData(data: HeatmapData): void;
  destroy(): void;
};

export function createHeatmapRenderer(
  canvas: HTMLCanvasElement,
  data: HeatmapData,
): HeatmapGL {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false })!;
  if (!gl) throw new Error('WebGL2 not supported');

  const program = createProgram(gl);
  gl.useProgram(program);

  // Uniform locations
  const u_rangeX = gl.getUniformLocation(program, 'u_rangeX')!;
  const u_rangeY = gl.getUniformLocation(program, 'u_rangeY')!;
  const u_barHalfWidth = gl.getUniformLocation(program, 'u_barHalfWidth')!;
  const u_brightnessMin = gl.getUniformLocation(program, 'u_brightnessMin')!;
  const u_brightnessMax = gl.getUniformLocation(program, 'u_brightnessMax')!;

  // Attribute locations
  const a_pos = gl.getAttribLocation(program, 'a_pos');
  const a_price = gl.getAttribLocation(program, 'a_price');
  const a_yOffset = gl.getAttribLocation(program, 'a_yOffset');
  const a_size = gl.getAttribLocation(program, 'a_size');
  const a_side = gl.getAttribLocation(program, 'a_side');
  const a_brightness = gl.getAttribLocation(program, 'a_brightness');
  const a_highlightColor = gl.getAttribLocation(program, 'a_highlightColor');

  // VAO
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Unit quad: [0,1] x [0,1]
  const quadVerts = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const quadVBO = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

  const quadEBO = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadEBO);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices, gl.STATIC_DRAW);

  // Instance attribute: price
  const priceBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, priceBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.prices, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(a_price);
  gl.vertexAttribPointer(a_price, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(a_price, 1);

  // Instance attribute: yOffset
  const yOffsetBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, yOffsetBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.yOffsets, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(a_yOffset);
  gl.vertexAttribPointer(a_yOffset, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(a_yOffset, 1);

  // Instance attribute: size
  const sizeBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.sizes, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(a_size);
  gl.vertexAttribPointer(a_size, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(a_size, 1);

  // Instance attribute: side (already Float32Array from worker)
  const sideBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, sideBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.sides, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(a_side);
  gl.vertexAttribPointer(a_side, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(a_side, 1);

  // Instance attribute: brightness
  const brightnessBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, brightnessBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.brightness, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(a_brightness);
  gl.vertexAttribPointer(a_brightness, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(a_brightness, 1);

  // Instance attribute: highlight color (RGBA, initialized to zeros = no highlight)
  const highlightBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, highlightBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.count * 4), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(a_highlightColor);
  gl.vertexAttribPointer(a_highlightColor, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(a_highlightColor, 1);

  gl.bindVertexArray(null);

  let instanceCount = data.count;
  let tickSize = data.tickSize;

  return {
    render(range: ViewRange, brightnessMin: number, brightnessMax: number) {
      const w = gl.canvas.width;
      const h = gl.canvas.height;
      gl.viewport(0, 0, w, h);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);
      gl.bindVertexArray(vao);

      gl.uniform2f(u_rangeX, range.priceMin, range.priceMax);
      gl.uniform2f(u_rangeY, range.yMin, range.yMax);
      gl.uniform1f(u_brightnessMin, brightnessMin);
      gl.uniform1f(u_brightnessMax, brightnessMax);

      // Bar width = one tick size, minimum 1 pixel
      const priceRange = range.priceMax - range.priceMin;
      const tickNDC = 2.0 * tickSize / priceRange;
      const onePixelNDC = 2.0 / w;
      const barHalfWidth = Math.max(onePixelNDC, tickNDC) / 2.0;
      gl.uniform1f(u_barHalfWidth, barHalfWidth);

      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, instanceCount);

      gl.bindVertexArray(null);
    },

    resize(width: number, height: number) {
      gl.canvas.width = width;
      gl.canvas.height = height;
    },

    updateHighlights(buffer: Float32Array) {
      gl.bindBuffer(gl.ARRAY_BUFFER, highlightBuf);
      gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.DYNAMIC_DRAW);
    },

    updateData(newData: HeatmapData) {
      const countChanged = newData.count !== instanceCount;
      instanceCount = newData.count;
      tickSize = newData.tickSize;

      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, priceBuf);
      gl.bufferData(gl.ARRAY_BUFFER, newData.prices, gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, yOffsetBuf);
      gl.bufferData(gl.ARRAY_BUFFER, newData.yOffsets, gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferData(gl.ARRAY_BUFFER, newData.sizes, gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, sideBuf);
      gl.bufferData(gl.ARRAY_BUFFER, newData.sides, gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, brightnessBuf);
      gl.bufferData(gl.ARRAY_BUFFER, newData.brightness, gl.DYNAMIC_DRAW);

      // Resize highlight buffer when count changes so it matches instanceCount.
      // Without this, drawElementsInstanced fails with GL_INVALID_OPERATION
      // because the highlight buffer is smaller than the other instance buffers.
      if (countChanged) {
        gl.bindBuffer(gl.ARRAY_BUFFER, highlightBuf);
        gl.bufferData(gl.ARRAY_BUFFER, newData.count * 4 * 4, gl.DYNAMIC_DRAW);
      }

      gl.bindVertexArray(null);
    },

    destroy() {
      gl.deleteBuffer(quadVBO);
      gl.deleteBuffer(quadEBO);
      gl.deleteBuffer(priceBuf);
      gl.deleteBuffer(yOffsetBuf);
      gl.deleteBuffer(sizeBuf);
      gl.deleteBuffer(sideBuf);
      gl.deleteBuffer(brightnessBuf);
      gl.deleteBuffer(highlightBuf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
