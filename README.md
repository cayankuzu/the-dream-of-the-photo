# The Dream of the Photo

*Every photograph is a door that opens only once.*

A photographer stands in a wet back alley at dusk, raises an instant camera and takes one picture. Scrolling
moves you through that single moment: the camera rising to the eye, the lens hunting for focus, the shutter,
the print sliding out and developing in the photographer's hand. Then you keep going, into the photograph,
and scrolling becomes walking through its dream:

- the rain stopped by the shutter hangs in the air; only behind you does it remember how to fall;
- washing lines across the alley are pegged with photographs of places a few steps further on;
- where the street should end it goes on, its buildings taller and more crooked, lit rooms under a sky that
  has turned to day over the night street (the puddles knew it first);
- a chair as large as a child remembers it stands over the way; further on, things have forgotten gravity;
- at the end hangs a print far too large, a picture of the sea; to leave a picture you walk deeper into it;
- behind it lies a mirror-still sea at dusk, lamps and doors standing in the water, a photograph for a moon,
  and the photographer, waiting with the camera raised. The last picture is of you, arriving.

It plays like a game: a title screen, chapters announced as you reach them, a journey bar, a gaze reticle,
eight hidden **memories** that reveal themselves to a long enough look (found ones are remembered between
visits), a pause menu (Esc) and an ending. Every word, the narration included, is in Turkish and English;
switch at any time from the title screen, the HUD or the menu (the browser's language is the default, the
choice is remembered, and `?lang=en` / `?lang=tr` force one).

A scroll-driven real-time piece built with three.js, TypeScript and Vite. No framework.

## Running it

Requires Node.js 20.19+ or 22.12+ (Vite 8) and a browser with WebGL 2.

```sh
npm install
npm run dev       # development server on http://localhost:4317 (strict port)
npm run build     # type check (tsc --noEmit), then production build into dist/
npm run preview   # serve dist/ locally (http://localhost:4173)
```

Everything is preloaded before the piece starts (the experience is one continuous shot, so nothing may pop
in later); the title screen shows the progress.

## Controls

| Input | Action |
| --- | --- |
| Mouse wheel, trackpad | Move through the moment, forward or back; inside the photograph, walk. Scroll is time: input is damped, speed-limited and slowed down around key beats, so nothing can be skipped. |
| Touch | Swipe vertically to move through the moment and to walk. Inside the photograph a drag that starts sideways looks around; two fingers always walk. |
| Keyboard | Arrow Down / Space forward, Arrow Up back; Page Down / Page Up take three steps; Arrow Left / Right turn the head inside the photograph; Enter begins; Esc opens and closes the menu. |
| Drag (mouse or touch) | Look around inside the photograph; while you walk the gaze drifts back to the way ahead. Resting your gaze on something draws the view toward it, and fills the reticle's ring when it is a memory. |
| HUD | Top right: memories found, language (TR / EN), sound, menu. The menu resumes, starts over, switches language, sound and full screen, and lists the controls. |

## Debug overlay

Open `http://localhost:4317/?debug`. The overlay exists only in development builds (`npm run dev`); in
production `?debug` does nothing.

- Shows fps, draw calls, triangles, textures and geometries, pixel ratio, timeline progress and target,
  the current phase, the active view (`outer`, `portal`, `world`, `sea`, `awake`), transition and walk values,
  camera position and asset loading.
- Keys `1`–`9`, `0`, `-`, `=` jump to the start of the twelve phases, in order: `INTRO`, `CAMERA_RAISE`,
  `AIM`, `FOCUS`, `CAPTURE`, `PHOTO_EJECT`, `PHOTO_REVEAL`, `PHOTO_APPROACH`, `PHOTO_DEPTH`, `PHOTO_ENTRY`,
  `WORLD`, `EXPLORATION`.
- `?debug&p=0.5` deep-links to a timeline position between 0 and 1. Positions past the shutter take the
  picture at its exact beat first, so the print is always correct (the same holds for the last picture).
- `window.__exp` is the running `Experience` instance.

## Architecture

```
src/
  main.ts                    entry: WebGL 2 check, starts the Experience
  config/                    every tunable value (units: meters, seconds, degrees)
  experience/
    Experience.ts            owns the scene and the frame loop; picks the view and renders it
    assets/Assets.ts         loads models, PBR sets and HDRIs before the start, reports progress
    timeline/                scroll as cinematic time: phases, damping, slow motion, beat crossings
    interaction/             ScrollInput (wheel, trackpad, touch, keys), LookControls (drag to look)
    director/                CameraDirector (shots, focus, hand-held motion, waking), DreamWalk (the walk),
                             DreamDirector (the dream: what differs, the lengthened alley, passes)
    dream/                   the dream's set pieces: FrozenRain, PhotoLines + Moments (pre-rendered
                             views), FloatingThings (giant chair, backwards clock), GiantPrint (the
                             passage into the sea), DreamSea + MirrorWater, PrintCard, ClockRig
    character/               Photographer (mocap scrubbed by the timeline, IK, print hand-off), TwoBoneIK
    camera-object/           InstantCamera, modeled in code
    photograph/              Photograph: the physical print and its image shader
    transition/PhotoPortal   capture camera, world camera and the geometry of the passage
    render/                  Pipeline (render targets, DOF, AgX, grain, adaptive resolution), Grade, GLSL
    world/                   Alley (facades, ground, props, cables, lights), FacadeBuilder, props, SkyDome
    audio/AudioEngine.ts     Web Audio: synthesized bed and mechanics, optional recorded samples
    debug/Debug.ts           development overlay (loaded on demand)
  ui/                        Overlay (title screen, HUD, pause menu, ending), Narration (subtitles), i18n (TR / EN)
```

- **Configuration.** `experience.config.ts` holds the twelve phases and their positions on the timeline,
  the photographer's performance, the camera shots, the transition, rendering and grades.
  `scene.config.ts` holds the alley layout, the facades, the lights and the instant camera's dimensions;
  `dream.config.ts` what differs inside the picture and its set pieces; `walk.config.ts` the walk (the
  camera path through the dream, and the waking); `sea.config.ts` the sea behind the giant print;
  `copy.config.ts` every word in both languages: the narration and when each line appears, the chapters,
  the memories and the interface; `audio.config.ts` the mix.
- **One scene, two worlds.** The real alley and the world inside the photograph are the same scene.
  Render layers separate what exists only in the real moment (the photographer, the held camera and
  print) from what exists only in the dream. `DreamDirector.setPass` switches shared objects (puddle
  reflections, the sky, the clock, the chair) between their real and dreamt state before each render.
- **The photograph is a real render.** At the shutter the scene is rendered from the lens of the instant
  camera into a texture, and that texture is the print. The dream's captured differences (another sky in
  the puddles, the figure at the far end, the photographer's shadow that stays) are already in it.

### Through the dream

During `WORLD` the scroll is a walk: `DreamWalk` turns a list of keyed poses (`walk.config.ts`) into
position, heading, pitch and field of view with monotone cubic curves, so scrolling forward walks, scrolling
back walks back the same way, and the speed changes smoothly. The viewer's own look is added on top.
The sea is drawn far away from the alley (beyond the far plane of either), so passing through the giant print
is a pure translation: the print shows a still of the sea from afar, a live window into it up close (the sea
rendered from where you stand, moved by the sea's offset, only inside the print's screen rectangle), and once
its image covers the view the sea is rendered directly — the same move that took you into the first
photograph. At the end the photographer standing on the water takes a picture; under its flash you are
outside again, and the print in their hand develops what they saw.

### From photo to world

`PhotoPortal` relies on one equivalence: seen from the ideal viewpoint (on the image axis, at the distance
where the print exactly fills the capture camera's frustum), every pixel of the flat print lies on the ray
the capture camera recorded, so the still and a live render of the world from the capture camera look
identical. At that point the print's image cross-fades, invisibly, from the still to the live render.
As the viewer keeps closing in, the camera inside the picture starts to travel, so the print becomes a
window with impossible depth. Once the image covers the whole screen the print is no longer drawn and the
world is rendered directly from that camera, which walks on until you stand inside the picture and can
look around.

## Asset pipeline

Models, materials and HDRIs are generated into `public/` from the list in `scripts/assets.json`:

```sh
npm run assets                       # everything
npm run assets -- --only key1,key2   # selected keys
```

`scripts/build-assets.mjs` downloads the sources (Poly Haven API, ambientCG archives) into
`.asset-cache/` (gitignored), then writes:

- `public/models/<key>.glb`: optionally only the listed modules of a kit, deduplicated, pruned, welded,
  optionally simplified, keyframes resampled, textures as WebP at the listed size, meshopt compression;
- `public/textures/<key>_{color,normal,orm}.webp`: color, OpenGL normal and packed AO / roughness /
  metalness;
- `public/hdri/<key>.hdr`: the original Radiance file.

The photographer is converted once from Microsoft Rocketbox FBX files with a browser-based tool:

```sh
node scripts/character/server.mjs    # then open http://localhost:4318/convert.html
```

The server fetches the avatar, textures and animations into `.asset-cache/rocketbox/`; the page converts
them with three.js (`FBXLoader` → `GLTFExporter`: meters, PBR materials, alpha-tested hair, the clips the
piece uses) and saves `.asset-cache/character/photographer.glb`. `npm run assets -- --only photographer`
then optimizes it like any other model.

The generated files in `public/` are part of the source tree, so building and deploying need neither the
network sources nor the converter.

## Deployment

The project deploys to Vercel as a static site; `vercel.json` sets the Vite preset, the build command
(`npm run build`) and the output directory (`dist`). Import the repository in Vercel, or run `vercel` /
`vercel --prod` from the project folder.

Caching: the bundle in `/assets/` is content-hashed and served as immutable for a year. The files in
`/models/`, `/textures/`, `/hdri/` and `/audio/` keep their names, so they are cached for one day and then
revalidated in the background (`stale-while-revalidate`); give a replaced asset a new file name if every
viewer must see it at once.

## Credits

Every asset, with its source, authors, license and role in the piece, is listed in
[ASSET_MANIFEST.md](ASSET_MANIFEST.md). License texts and notices for the Microsoft Rocketbox character,
three.js and the other bundled code are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
