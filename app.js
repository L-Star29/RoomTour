import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { GLTFLoader } from './GLTFLoader.js';
import { RoomEnvironment } from './RoomEnvironment.js';
import { MeshoptDecoder } from './meshopt_decoder.mjs';
import { chapters, about, reflection } from './content.js';
import { surfaceAnchor } from './surface_anchor.js';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const models = new Map(), pending = new Map(), seen = new Set();
let current = 'desk', currentModel = null, chosen = null, pins = [], drawerOpen = false, drawerAmount = 0, pinsVisible = true, transition = null, requestId = 0;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); renderer.setClearColor(0, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('viewer').appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, .01, 100);
camera.position.set(2, 1.7, 3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .09; controls.enablePan = false; controls.minPolarAngle = .15; controls.maxPolarAngle = Math.PI / 2 + .04; controls.rotateSpeed = .6; controls.zoomSpeed = .7;
const env = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
scene.environment = env.fromScene(room, .05).texture; room.dispose(); env.dispose();
scene.environmentIntensity = .55;
const hemi = new THREE.HemisphereLight(0xffffff, 0xc5b8a2, 1.25); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff6e9, 2.7); key.position.set(3, 6, 5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3; key.shadow.normalBias = .012; key.shadow.bias = -.0001; scene.add(key);
const fill = new THREE.DirectionalLight(0xe8edff, .9); fill.position.set(-4, 3, -3); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: .13 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.008; ground.receiveShadow = true; scene.add(ground);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function find(root, name) { let found; root.traverse(n => { if (norm(n.name) === norm(name) && !found) found = n }); return found }
function resize() { const b = $('viewer').getBoundingClientRect(); renderer.setSize(b.width, b.height); camera.aspect = b.width / b.height; camera.updateProjectionMatrix() }
new ResizeObserver(resize).observe($('viewer'));
function bounds(o) { return new THREE.Box3().setFromObject(o) }
function fly(target, position) { transition = { start: performance.now(), from: camera.position.clone(), to: position.clone(), a: controls.target.clone(), b: target.clone(), duration: reduced ? 1 : 950 }; }
function resetView() {
    if (!currentModel) return;
    const s = currentModel.userData.size, center = new THREE.Vector3(0, s.y * .49, 0);
    const span = Math.max(s.y, s.x / Math.max(camera.aspect, .65), s.z);
    const distance = span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.32;
    const dir = new THREE.Vector3(current === 'bed' ? 1.35 : .95, current === 'wardrobe' ? .55 : .85, 2.3).normalize();
    controls.minDistance = .23; controls.maxDistance = distance * 1.8; fly(center, center.clone().addScaledVector(dir, distance));
}
async function getModel(k) {
    if (models.has(k)) return models.get(k);
    if (pending.has(k)) return pending.get(k);
    const source = loader.loadAsync(`./${k}-web.glb`, event => { if (current === k) $('load-message').textContent = event.total ? `Loading ${chapters[k].name.toLowerCase()}… ${Math.round(event.loaded / event.total * 100)}%` : `Loading ${chapters[k].name.toLowerCase()}…`; });
    const p = source.then(gltf => {
        const root = gltf.scene; root.updateMatrixWorld(true);
        const b = bounds(root), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
        root.position.set(-c.x, -b.min.y, -c.z); root.updateMatrixWorld(true);
        root.userData.size = s; root.userData.drawer = find(root, 'Desk_Drawer_Slide');
        if (root.userData.drawer) root.userData.drawerStart = root.userData.drawer.position.clone();
        root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const mats = Array.isArray(o.material) ? o.material : [o.material]; for (const m of mats) { if (m.map) m.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } } });
        root.visible = false; scene.add(root); models.set(k, root); return root;
    }).finally(() => pending.delete(k)); pending.set(k, p); return p;
}

function setIndex() {
    $('index-list').replaceChildren();
    chapters[current].stories.forEach((s, i) => {
        const b = document.createElement('button'); b.innerHTML = `<small>${seen.has(current + '/' + s.id) ? '✓' : String(i + 1).padStart(2, '0')}</small><span>${s.label}</span>`;
        b.onclick = () => { selectStory(s.id); toggleIndex(false) }; $('index-list').appendChild(b);
    });
}
function makePins() {
    $('pins').replaceChildren(); pins = [];
    for (const s of chapters[current].stories) {
        const object = find(currentModel, s.object);
        if (!object) { console.warn('Missing story object', current, s.object); continue }
        object.userData.storyId = s.id;
        const box = bounds(object); let center = box.getCenter(new THREE.Vector3());
        // Anchor on the front or top surface, keeping the marker attached during drawer motion.
        center.z = box.max.z + .008;
        if (s.drawer || ['mat', 'keyboard', 'mouse', 'bedding'].includes(s.id)) { center.y = box.max.y + .012; center.z = (box.min.z + box.max.z) / 2 }
        if (s.anchor) { center = surfaceAnchor(find(currentModel, s.anchorObject || s.object) || object, s.anchor, s.anchorFraction) }
        const local = object.worldToLocal(center.clone());
        const el = document.createElement('button'); el.className = 'pin'; el.innerHTML = `+<span>${s.label}</span>`; el.setAttribute('aria-label', s.label); el.onclick = () => selectStory(s.id);
        if (s.alwaysVisible) el.style.zIndex = '5';
        $('pins').appendChild(el); pins.push({ el, object, local, s });
    }
}
async function changeScene(k, fromHash = false) {
    if (!chapters[k]) return; const ticket = ++requestId; current = k; chosen = null; drawerOpen = false; drawerAmount = 0; transition = null;
    document.body.classList.remove('story-open'); document.body.style.background = chapters[k].color;
    $('intro').hidden = false; $('story').hidden = true; $('pins').replaceChildren(); pins = []; toggleIndex(false);
    if (currentModel) currentModel.visible = false; currentModel = null;
    const ch = chapters[k]; $('chapter-kicker').textContent = ch.name; 
    $('chapter-title').innerHTML = ch.title; $('chapter-copy').textContent = ch.copy; 
      $('close-story').textContent = `← Back to ${ch.name.toLowerCase()}`;
    document.querySelectorAll('[data-scene]').forEach(b => { b.classList.toggle('active', b.dataset.scene === k); b.setAttribute('aria-current', b.dataset.scene === k ? 'page' : 'false') });
    $('drawer').hidden = k !== 'desk'; updateDrawerLabel(); $('loading').hidden = false; $('load-message').textContent = `Loading ${ch.name.toLowerCase()}…`;
    $('viewer').setAttribute('aria-label', `3D ${ch.name.toLowerCase()}. Drag to rotate, scroll to zoom, or choose a named story in the object index.`);
    setIndex(); if (!fromHash) history.replaceState(null, '', '#' + k);
    try {
        const model = await getModel(k); if (ticket !== requestId) return; currentModel = model; model.visible = true;
        if (model.userData.drawer) model.userData.drawer.position.copy(model.userData.drawerStart);
        model.updateMatrixWorld(true); makePins(); resize(); resetView(); $('loading').hidden = true;
    } catch (e) { console.error(e); $('load-message').textContent = 'The model couldn’t load. Refresh to try again; the object index still has every story.'; document.querySelector('.loading-ring').hidden = true }
}
function setDrawer(open, focus = true) {
    if (current !== 'desk' || !currentModel?.userData.drawer) return;
    drawerOpen = open; updateDrawerLabel();
    if (focus && open) { fly(new THREE.Vector3(-.12, .68, .3), new THREE.Vector3(.4, 1.85, 1.65)) }
    else if (focus) resetView();
}
function updateDrawerLabel() { $('drawer').innerHTML = drawerOpen ? 'Close drawer' : 'Open drawer'; $('drawer').setAttribute('aria-expanded', String(drawerOpen)) }
function selectStory(id) {
    const s = chapters[current].stories.find(s => s.id === id); if (!s) return; chosen = s; seen.add(current + '/' + id); setIndex();
    $('intro').hidden = true; $('story').hidden = false; document.body.classList.add('story-open');
     $('story-title').textContent = s.name; $('story-body').textContent = s.body; $('story-count').textContent = `${String(chapters[current].stories.indexOf(s) + 1).padStart(2, '0')} / ${String(chapters[current].stories.length).padStart(2, '0')}`;
    history.replaceState(null, '', `#${current}/${id}`);
    const ob = currentModel && find(currentModel, s.object);
    if (s.drawer) { setDrawer(true, true) }
    else if (ob) {
        const b = bounds(ob), target = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
        const min = current === 'desk' ? .6 : .95;
        const d = Math.max(min, Math.max(size.x, size.y, size.z) * 2.2);
        const dir = new THREE.Vector3(s.id === 'cap' ? 1.6 : .65, s.id === 'bedding' ? 1.35 : .65, 2).normalize();
        fly(target, target.clone().addScaledVector(dir, d));
    }
}
function closeStory() {
    chosen = null; $('story').hidden = true; $('intro').hidden = false; document.body.classList.remove('story-open');
    history.replaceState(null, '', '#' + current); resetView();
}
function toggleIndex(v) { $('object-index').hidden = !v; $('index-toggle').setAttribute('aria-expanded', String(v)) }
function showNote(note) { $('note-kicker').textContent = note.kicker; $('note-title').textContent = note.title; $('note-body').replaceChildren(); for (const t of note.paragraphs) { const p = document.createElement('p'); p.textContent = t; $('note-body').appendChild(p) } if (note.signature) { const sig = document.createElement('p'); sig.className = 'signature'; sig.textContent = note.signature; $('note-body').appendChild(sig); } $('note').showModal() }
$('about').onclick = () => showNote(about); $('reflection').onclick = () => showNote(reflection); $('close-note').onclick = () => $('note').close();
$('note').addEventListener('click', e => { if (e.target === $('note')) { const r = $('note').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('note').close() } });
$('index-toggle').onclick = () => toggleIndex($('object-index').hidden); $('close-index').onclick = () => toggleIndex(false);
$('discover').onclick = () => selectStory(chapters[current].stories.find(s => !seen.has(current + '/' + s.id))?.id ?? chapters[current].stories[0].id);
$('next-story').onclick = () => { const a = chapters[current].stories; selectStory(a[(a.indexOf(chosen) + 1) % a.length].id) };
$('close-story').onclick = closeStory; $('reset').onclick = () => { closeStory(); setDrawer(false, false) }; $('drawer').onclick = () => setDrawer(!drawerOpen);
$('toggle-pins').onclick = () => { pinsVisible = !pinsVisible; $('toggle-pins').setAttribute('aria-pressed', String(pinsVisible)) };
for (const [id, factor] of [['zoom-in', .8], ['zoom-out', 1.25]]) $(id).onclick = () => { const v = camera.position.clone().sub(controls.target), len = THREE.MathUtils.clamp(v.length() * factor, controls.minDistance, controls.maxDistance); fly(controls.target, camera.position.clone().copy(controls.target).add(v.setLength(len))) };
document.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => changeScene(b.dataset.scene));
controls.addEventListener('start', () => { transition = null });
let down = null; renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY } });
renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || !currentModel) return;
    const b = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1); ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(currentModel, true)[0]; if (!hit) return;
    let ob = hit.object; while (ob && ob !== currentModel) { if (ob.userData.storyId) { selectStory(ob.userData.storyId); return } if (ob === currentModel.userData.drawer) { setDrawer(!drawerOpen); return } ob = ob.parent }
});
document.addEventListener('keydown', e => { if ($('note').open) return; if (e.key === 'Escape') { toggleIndex(false); closeStory() } if (/^[123]$/.test(e.key)) changeScene(['desk', 'wardrobe', 'bed'][+e.key - 1]) });
window.addEventListener('hashchange', () => { const [key, id] = location.hash.slice(1).split('/'); changeScene(chapters[key] ? key : 'desk', true).then(() => { if (id) selectStory(id) }) });
const p3 = new THREE.Vector3(); let previous = performance.now();
function tick(time) {
    requestAnimationFrame(tick); const dt = Math.min((time - previous) / 1000, .05); previous = time;
    if (transition) { const t = Math.min(1, (time - transition.start) / transition.duration), e = 1 - (1 - t) ** 3; camera.position.lerpVectors(transition.from, transition.to, e); controls.target.lerpVectors(transition.a, transition.b, e); if (t === 1) transition = null }
    controls.update();
    if (currentModel?.userData.drawer) {
        const target = drawerOpen ? 1 : 0; drawerAmount = THREE.MathUtils.damp(drawerAmount, target, reduced ? 1000 : 7, dt);
        // glTF changes Blender -Y drawer travel to browser +Z.
        currentModel.userData.drawer.position.copy(currentModel.userData.drawerStart); currentModel.userData.drawer.position.z += .44 * drawerAmount;
    }
    scene.updateMatrixWorld(true);
    const b = $('viewer').getBoundingClientRect(), occupied = [];
    for (const pin of pins) {
        pin.object.localToWorld(p3.copy(pin.local)); p3.project(camera);
        let x = (p3.x * .5 + .5) * b.width, y = (-p3.y * .5 + .5) * b.height;
        if (pin.s.alwaysVisible) { x = THREE.MathUtils.clamp(x, 19, b.width - 19); y = THREE.MathUtils.clamp(y, 19, b.height - 43) }
        const overlaps = occupied.some(q => Math.hypot(q.x - x, q.y - y) < 30);
        const show = pinsVisible && p3.z > -1 && p3.z < 1 && x > 18 && x < b.width - 18 && y > 18 && y < b.height - 42 && (!pin.s.drawer || drawerAmount > .9) && (pin.s.alwaysVisible || !overlaps || chosen?.id === pin.s.id);
        pin.el.hidden = !show;
        if (show) { occupied.push({ x, y }); pin.el.style.transform = `translate(${x - 13}px,${y - 13}px)`; pin.el.classList.toggle('selected', chosen?.id === pin.s.id); pin.el.classList.toggle('read', seen.has(current + '/' + pin.s.id)) }
    }
    renderer.render(scene, camera);
}
requestAnimationFrame(tick); resize();
const [initial, id] = location.hash.slice(1).split('/');
changeScene(chapters[initial] ? initial : 'desk', true).then(() => { if (id) selectStory(id) });
