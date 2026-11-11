# The Dream of the Photo

> Bir fotoğrafın rüyası saç beyazlatır,
> Bir fotoğrafın rüyası her akşam yarım.
>
> *The dream of a photograph turns hair white,*
> *The dream of a photograph, every evening, half.*

A narrated nightmare in real time, thirty-three minutes long, cut like a short film. One evening at half past six
you got up from the dinner table, said you would be right back, went out into the street and took a photograph of
the house. The photograph is the narrator. While its image comes up in your hand it dreams that you never go back
in: thirty-three years in seven evenings, a minute for every year. It moves by itself; scrolling only hurries it
or holds it back for a moment; dragging looks around.

It opens in the dark, on the sound of the table. Each evening is a run of short scenes, each a nightmare built on
a common fear, between stretches of the dream's walk:

- **The First Evening, Hair:** a corridor that does not end, a barber who cuts your hair white, a waiting room, birches with eyes, a ceiling of spiders.
- **The Second Evening, Half:** the dinner under insects, a cellar of plates, a duct that narrows, the family portrait without you, the dentist's needle.
- **The Third Evening, Sleep:** a bus, an aeroplane with your kitchen flying alongside, a telephone in an empty square, a lift that stops, beds in a field, a mirror that lags behind you, sleep paralysis.
- **The Fourth Evening, Water:** a house going under, the deep, a drained pool of snakes, lost as a child in a market, a hospital ward.
- **The Fifth Evening, Dark:** the dark and your own flash, washing lines with faces, an attic of dolls, a chase, the birds that bring the news, being buried.
- **The Sixth Evening, Nothing:** a steel beam over a storm, the fall down a shaft, holes, a beach of teeth, an exam, a birthday party, a car with no one at the wheel, coming home unseen.
- **The Last Evening, You:** home, the stairs, your own funeral, the corridor, and the table.

Every evening breaks off in the middle of a word: the narrator begins the motto and is cut dead, a little later
each evening, and the lullaby with it; you are back in the street for a moment, the print in your hand a little
further along, your hair a little whiter, the window of the house a little emptier. On the last evening the dream
reaches its end. Then the street as it really is, and one choice.

The narrator, the voice from the house and the people of the dream speak (synthetic voices, made with
`scripts/voice/`); every spoken line is also shown as a subtitle. The score is the lullaby, written for the piece
(`scripts/build-score.py`). Space itself curves through the piece (`src/experience/render/Warp.ts`), and things
change only when you are not looking. The title screen carries a content warning (adults only; it names the
fears), and any part can be skipped from the menu (Esc or M). Every word is in Turkish and English; switch at any
time (the browser's language is the default, the choice is remembered, and `?lang=en` / `?lang=tr` force one).

A scroll-driven real-time piece built with three.js, TypeScript and Vite. No framework.

## Running it

Requires Node.js 20.19+ or 22.12+ (Vite 8) and a browser with WebGL 2.

```sh
npm install
npm run dev       # development server on http://localhost:4317 (strict port)
npm run build     # type check (tsc --noEmit), then production build into dist/
npm run preview   # serve dist/ locally (http://localhost:4173)
```

The opening is preloaded before the piece starts, and the title screen shows the progress. Each room's files
are fetched while the one before it plays and it is built under the cut to black, so nothing pops in; a room
is dropped from memory as soon as it lies behind you.

## Controls

| Input | Action |
| --- | --- |
| Mouse wheel, trackpad | Move through the moment, forward or back; inside the photograph, walk. Scroll is time: input is damped, speed-limited and slowed down around key beats, so nothing can be skipped. |
| Touch | Swipe vertically to move through the moment and to walk. Inside the photograph a drag that starts sideways looks around; two fingers always walk. |
| Keyboard | Arrow Down / W / Space forward, Arrow Up / S back; Page Down / Page Up take three steps; Arrow Left / Right or A / D turn the head inside the photograph (W, A, S and D by their place on the keyboard, whatever the layout); Enter begins; Esc or M opens and closes the menu (M also in full screen, where the browser keeps Esc). |
| Drag (mouse or touch) | Look around inside the photograph; while you walk the gaze drifts back to the way ahead. Resting your gaze on something draws the view toward it. |
| HUD | Only while the pointer moves: the evening and the year the dream has reached, sound, voice, language (TR / EN), menu. The menu resumes, skips a part, starts over, switches language, sound, the narrator's voice and full screen, and lists the controls. |

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
- `?debug&room=<id>` starts at a room of the journey (a file name in `src/experience/rooms/list`, with
  `@n` for a later visit, for example `corridor@4` or `evening@7`).
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
    rooms/                   the journey: JourneyDirector (fetches each room ahead, builds it under the cut
                             to black, drops what lies behind), Room (the contract every room keeps),
                             RoomKit (shared set dressing), RoomSound (a room's own files, levelled per
                             room), Album (the pictures the shutter keeps), Swarm, Snakes, Fire,
                             list/*.ts (one file per room)
    audio/AudioEngine.ts     Web Audio: synthesized bed and mechanics, optional recorded samples
    debug/Debug.ts           development overlay (loaded on demand)
  ui/                        Overlay (title screen, HUD, pause menu, ending), Narration (subtitles), i18n (TR / EN)
```

- **Configuration.** `experience.config.ts` holds the twelve phases and their positions on the timeline,
  the photographer's performance, the camera shots, the transition, rendering and grades.
  `scene.config.ts` holds the alley layout, the facades, the lights and the instant camera's dimensions;
  `dream.config.ts` what differs inside the picture and its set pieces; `walk.config.ts` the walk (the
  camera path through the dream, and the waking); `sea.config.ts` the sea behind the giant print;
  `copy.config.ts` the words of the interface in both languages; `film.config.ts` the narrator's lines and
  the score's cues and where each falls, and the street between the evenings; `audio.config.ts` the mix,
  including each room's level and the film's voice and score buses; `journey.config.ts` the seven evenings,
  the order of their walks, rooms and wakings, how long each lasts on the screen and which part of a room's
  own script is shown (rooms are cut like shots: entered late, left early, run faster).
- **One scene, two worlds.** The real alley and the world inside the photograph are the same scene.
  Render layers separate what exists only in the real moment (the photographer, the held camera and
  print) from what exists only in the dream. `DreamDirector.setPass` switches shared objects (puddle
  reflections, the sky, the clock, the chair) between their real and dreamt state before each render.
- **The photograph is a real render.** At the shutter the scene is rendered from the lens of the instant
  camera into a texture, and that texture is the print. The dream's captured differences (another sky in
  the puddles, the figure at the far end, the photographer's shadow that stays) are already in it.
- **Nothing is made in the middle of a scene.** Shader programs are compiled ahead (`Pipeline.compileScene`)
  for the linear target the scene draws into, never for the screen: at load for the real moment and for the
  dream, and for each room and each stretch of the walk while the cut to black holds. On the first frame of a
  room or of a stretch of the walk, still under the cut, everything it keeps hidden or out of reach for later
  is drawn once more, small and unseen, so that no shadow pass, picture or buffer is first needed at a reveal.

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

The rooms' own files come from three more scripts: `node scripts/build-scans.mjs` (scanned and found models,
cleaned and scaled), `node scripts/build-props.mjs` (props assembled or reposed here, such as the sitting
dogs) and `python scripts/build-room-audio.py` (every sound under `public/audio/rooms`, cut, filtered and
levelled from its CC0 or CC BY source; `--only <names>` rebuilds some, `--check` compares the recipes with
the shipped files, `--docs` writes the sound index and notices).

The film's own sound comes from two more: `python -I scripts/build-score.py --out public/audio/score` (the
lullaby and the cues under `public/audio/score`, rendered from CC0 samples and checked by measurement) and the
voice pipeline in `scripts/voice/` (see its README: gather the lines, speak them locally, write
`src/config/voice.manifest.ts`).

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
