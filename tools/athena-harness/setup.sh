#!/usr/bin/env bash
# One-time setup for the Athena Engine test harness (see README.md).
# Fetches three.js r128 + the addons the editor loads from the CDN in production,
# two small test models, and builds www/ — a static root that serves the live
# /public/src alongside those local copies, so the editor can be driven with
# no CDN access at all (the sandbox that built it had none).
set -euo pipefail
cd "$(dirname "$0")"
B=https://raw.githubusercontent.com/mrdoob/three.js/r128
mkdir -p three/js/controls three/js/loaders three/models www shots artifact
curl -sSL -o three/three.min.js "$B/build/three.min.js"
curl -sSL -o three/js/controls/OrbitControls.js "$B/examples/js/controls/OrbitControls.js"
curl -sSL -o three/js/controls/TransformControls.js "$B/examples/js/controls/TransformControls.js"
curl -sSL -o three/js/loaders/GLTFLoader.js "$B/examples/js/loaders/GLTFLoader.js"
curl -sSL -o three/models/Duck.glb "$B/examples/models/gltf/Duck/glTF-Binary/Duck.glb"
curl -sSL -o three/models/Flamingo.glb "$B/examples/models/gltf/Flamingo.glb"
cat > three/models/manifest.json <<'JSON'
{ "models": [
  { "id": "duck", "label": "Duck", "url": "/models/Duck.glb", "cat": "Test" },
  { "id": "flamingo", "label": "Flamingo (animated)", "url": "/models/Flamingo.glb", "cat": "Test", "anims": ["flamingo_flyA_"] }
] }
JSON
ln -sfn ../../../public/src www/src
ln -sfn ../three www/three
ln -sfn ../three/models www/models
ln -sfn ../artifact www/artifact
cp harness.html www/harness.html
echo "ready. Start the server:  (cd www && python3 -m http.server 8765 --bind 127.0.0.1)"
