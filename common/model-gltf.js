// Export the original geometry at authored metre scale, independent of the
// viewer's rotation/zoom/wireframe. Embedded buffer means a single portable file.
export function modelToGltf(object) {
  const gltf = {
    asset: { version: '2.0', generator: 'Noah’s VR model library', extras: object.userData,
      copyright: `BSD 2-Clause License

Copyright (c) 2026, Noah Wright

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.` },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: object.name, mesh: 0 }],
    meshes: [{ primitives: [] }], materials: [], buffers: [], bufferViews: [], accessors: [],
  };
  const chunks = [];
  let byteLength = 0;
  function attribute(array, minMax = false) {
    const data = new Float32Array(array);
    const view = gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.byteLength, target: 34962 }) - 1;
    chunks.push(new Uint8Array(data.buffer));
    byteLength += data.byteLength;
    const accessor = { bufferView: view, componentType: 5126, count: data.length / 3, type: 'VEC3' };
    if (minMax) {
      accessor.min = [Infinity, Infinity, Infinity]; accessor.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i++) {
        const axis = i % 3;
        accessor.min[axis] = Math.min(accessor.min[axis], data[i]);
        accessor.max[axis] = Math.max(accessor.max[axis], data[i]);
      }
    }
    return gltf.accessors.push(accessor) - 1;
  }
  // createModel() bakes primitive transforms into mesh coordinates; these
  // immediate child meshes have identity transforms and non-indexed triangles.
  for (const mesh of object.children) {
    const color = mesh.material.color;
    const material = gltf.materials.push({ name: mesh.name, pbrMetallicRoughness: {
      baseColorFactor: [color.r, color.g, color.b, 1], metallicFactor: 0, roughnessFactor: 0.8,
    } }) - 1;
    gltf.meshes[0].primitives.push({ attributes: {
      POSITION: attribute(mesh.geometry.attributes.position.array, true),
      NORMAL: attribute(mesh.geometry.attributes.normal.array),
    }, material, mode: 4 });
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  gltf.buffers.push({ byteLength, uri: `data:application/octet-stream;base64,${btoa(binary)}` });
  return gltf;
}
