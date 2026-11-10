# Third-party notices

The Dream of the Photo ships, or downloads at run time, the third-party material listed below. Each
asset file is listed individually in [ASSET_MANIFEST.md](ASSET_MANIFEST.md).

## Microsoft Rocketbox (MIT)

The photographer and the people of the nightmare (`public/models/photographer.glb`, `figure_man.glb`, `figure_nurse.glb`,
`figure_woman.glb`, `figure_child.glb`) are converted from the Microsoft Rocketbox avatar library: avatars `Male_Adult_07`,
`Male_Adult_03`, `Medical_Female_01`, `Female_Adult_02`, `Male_Child_01` and the animations listed in
`scripts/character/avatars.json`. `public/models/coat.glb`, the empty jacket in one of the rooms, is cut from `figure_man.glb`
by `scripts/build-props.mjs` and is under the same license.

Source: https://github.com/microsoft/Microsoft-Rocketbox

```
MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The library is described in M. Gonzalez-Franco et al., "The Rocketbox library and the utility of freely
available rigged avatars", Frontiers in Virtual Reality, 2020, doi:10.3389/frvir.2020.561558.

## three.js (MIT)

The JavaScript bundle contains three.js 0.186 and the add-ons the piece imports from it (`GLTFLoader`,
`HDRLoader`, `RoundedBoxGeometry`, `SkeletonUtils`).

Source: https://github.com/mrdoob/three.js

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## meshoptimizer decoder (MIT)

The bundle also contains the meshoptimizer decoder (shipped with three.js as
`examples/jsm/libs/meshopt_decoder.module.js`), which decompresses the meshopt-compressed models.

Source: https://github.com/zeux/meshoptimizer

```
MIT License

Copyright (c) 2016-2026 Arseny Kapoulkine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Vite (MIT)

Vite injects a short module-preload polyfill into the production bundle.
Copyright (c) 2019-present, VoidZero Inc. and Vite contributors. MIT License, same terms as above.
Source: https://github.com/vitejs/vite

## CC BY assets (credit required)

- **Realistic Human Heart** by neshallads, CC BY 4.0, https://sketchfab.com/3d-models/realistic-human-heart-3f8072336ce94d18b3d0d055a1ece089 (converted, decimated).
- **土偶 [馬高遺跡出土] (Clay figurines)** by 長岡市立科学博物館 / Nagaoka Municipal Science Museum, CC BY 4.0, https://sketchfab.com/3d-models/clay-figurines-c65e79e6c6db4f96b40dcfaa4c1be80b (converted, decimated).
- **Victorian age Dentist chair** by li chang, CC BY 3.0, https://poly.pizza/m/83KoxfvZ1pO (converted, merged).
- **Teeth** by Poly by Google, CC BY 3.0, https://poly.pizza/m/eNR_DPPP1Hp (split, normalized).
- **Raven** by Poly by Google, CC BY 3.0, https://poly.pizza/m/5oae0lwh9fF (repainted).
- **Low Poly Giant Spider** by p0ss, CC BY 3.0, https://opengameart.org/content/low-poly-giant-spider, a low-poly version of **Spider** by sunburn, CC BY 3.0, https://opengameart.org/content/spider; hair in its texture from p0ss's Woodland Animals Texture Pack, photograph by Michelle Buntin (converted, legs given pivots, scaled, decimated for the crowd; `spider`, `spider_low`).
- **Japanese Train Station Bench** by Andrew-John Hickman, CC BY 3.0, https://poly.pizza/m/0lu4tQLuAqL (converted, scaled, repainted; `seats_row`).
- **Theatre Seat** by Cormac White, CC BY 3.0, https://poly.pizza/m/b0nT_HhiCM4 (converted, scaled, repainted; `seat_theatre`).
- **Pair of shoes** by Poly by Google, CC BY 3.0, https://poly.pizza/m/3MskwjG-x4L (converted, scaled; `shoes_leather`).
- **Syringe** by J-Toastie, CC BY 3.0, https://poly.pizza/m/MURJ8NK4N9 (converted, scaled; `syringe`).
- **Dental mirror** by Poly by Google, CC BY 3.0, https://poly.pizza/m/c3To3yEtGzg (converted, scaled, repainted; `dental_mirror`).
- **Scalpel** by Poly by Google, CC BY 3.0, https://poly.pizza/m/9yKgpOpblnf (converted, scaled, repainted; `scalpel`).
- **old lamp** by Justin Randall, CC BY 3.0, https://poly.pizza/m/73r4EQM-Z8e (converted, scaled, decimated; `lamp_floor`).
- **Window** by Poly by Google, CC BY 3.0, https://poly.pizza/m/c1GNuOg06si (converted, scaled, repainted; `window_wood`).
- **Curtains** by Poly by Google, CC BY 3.0, https://poly.pizza/m/9bI1TGwmvzD (converted, scaled, repainted; `curtains`).
- **Staircase** by Poly by Google, CC BY 3.0, https://poly.pizza/m/0pEtBW3giNY (converted, scaled; `staircase`).
- **Bus Stop** by Zsky, CC BY 3.0, https://poly.pizza/m/OWczicNWhO (converted, scaled, repainted; `bus_shelter`).
- **Montreal Bus** by Nick Ladd, CC BY 3.0, https://poly.pizza/m/fFCCghvRImG (converted, scaled, decimated; `bus_city`).
- **Easel** by Poly by Google, CC BY 3.0, https://poly.pizza/m/6UQpoYGTvkL (converted, scaled, repainted; `easel`).
- **Roses** by Christopher F, CC BY 3.0, https://poly.pizza/m/1SUvEuQWCD2 (converted, scaled, repainted, decimated; `roses`).
- **Gramophone** by Don Carson, CC BY 3.0, https://poly.pizza/m/9MZ0sCt1REv (converted, scaled; `gramophone`).
- **Cockroach** by Poly by Google, CC BY 3.0, https://poly.pizza/m/eSCFQN_47V4 (converted, scaled, decimated for the crowd; `roach`, `roach_low`).
- **Fly** by Poly by Google, CC BY 3.0, https://poly.pizza/m/c7w1u4mSnXZ (converted, scaled, repainted; `fly`).
- **GRADD Hospital Room** by GRADD CO, CC BY 3.0, https://poly.pizza/m/9sUalfQ76kn (one component of the room, converted, scaled; `iv_stand`, `monitor_ecg`, `xray_light`); its textures are signed "Texture Image by: Brady Arnold", and the signature stays in them.
- **Loud Bang Crashing Metal Chunk Dropped in Metal Dumpster** (https://freesound.org/s/859154/) and **Annoying Voiceover Wet Mouth Clicks** (https://freesound.org/s/861352/) by qubodup: CC0 on their Freesound pages, while the uploader's signature points to the CC BY credit on the uploader's profile, so qubodup is credited here and in the menu and either reading is met (cut, filtered and re-encoded into files under `audio/rooms/`, listed in ASSET_MANIFEST.md).

## Public domain and CC0 models and scans

Royal Cast Collection, SMK (Statens Museum for Kunst), Public Domain Mark 1.0; Smithsonian Institution, CC0 1.0; The Hunt Museum and Musée Saint-Raymond,
CC0 1.0 (via Wikimedia Commons and Sketchfab); OpenGameArt authors Drummyfish, CDmir and plaggy, CC0 1.0; Khronos glTF Sample Assets (Corset, Antique Camera), CC0 1.0;
Poly Pizza authors hat_my_guy, iPoly3D, Isa Lousberg, lakescorp and Quaternius, CC0 1.0; The Base Mesh (thebasemesh.com), CC0.
No credit is required for these; it is given with thanks. Each file is listed in ASSET_MANIFEST.md.

## Courtesy credits for sounds (CC0)

Freesound uploaders who ask for or welcome a credit: 232148 (Ring Around the Rosie, Child Vocal), 367679 (Horror Scream Echo); every sound is listed in ASSET_MANIFEST.md.

Freesound uploaders who ask for or welcome a credit, in the rooms: 20108 (air over mic.wav, by cognito perceptu: his profile: he likes to be credited as cognito perceptu); 79382 (boxofscrews.wav, by j1987: credit welcomed); 185059 (Deafening Whispers, by unfa: if credited: Tobiasz 'unfa' Karoń, with a link to the sound); 202612 (FXLM neon lights flicker bathroom.wav, by LudwigMueller: credit welcomed); 209014 (Ceramic Tink, by OwlStorm: no credit needed; if given, Ashe Kirk or Owlish Media); 215385 (porcelain clinks slides.wav, by Reitanna: the profile recommends a credit, as Reitanna Seishin); 216606 (Strange Cloth Rubbing, by unfa: if credited: Tobiasz 'unfa' Karoń, with a link to the sound); 219677 (Wooden Chair Move.mp3, by harrietniamh: the profile asks for a credit when a sound is used in a production); 242867 (blowing out candle.wav, by Reitanna: the profile recommends a credit, as Reitanna Seishin); 273150 (Heart Beating, by michorvath: credit welcomed); 366159 (Underwater [Loop] AMB.wav, by DCSFX: credit optional); 376644 (Demential, strong wind through the edges of an aluminum door 1 @ 96 KHz 24bit, by Bronxio: credit optional, welcomed); 456037 (heavy breathing while running, by florianreichelt: the profile asks for a tag of instagram.com/florianreichelt in the description); 456433 (Old Rotary Phone Ringing - Western Electric Bell 500 phone, by mycompasstv: the profile: credit much appreciated, do not re-post the sound or claim it as your own); 459970 (Footsteps on hollow wood, by florianreichelt: the profile asks for a tag of instagram.com/florianreichelt in the description); 556722 (Record Player Needle is dropped & Vinyl crackling, by Breviceps: links to the work welcomed); 587442 (Dropping sheet metal, by SamsterBirdies: credit welcomed); 587443 (Scrap metal dropping / crashing, by SamsterBirdies: credit welcomed); 588400 (Concert Hall Silence Ambiance.mp3, by FunWithSound: credit welcomed); 706430 (swiming pool underwater.wav, by bruno.auzet: the profile asks you to think about crediting freesound.org); 786515 (ELECBuzz_An Incandescent lamp.The Last seconds.Unstable Buzzing_EM, by newlocknew: the profile asks for the nickname and the file name in the credits); 794817 (Fireplace Rumble, by SamsterBirdies: credit welcomed); 800114 (quartz crystal tapping ceramic plate-003.wav, by CVLTIV8R: credit welcomed); 800117 (shells and quartz crystals rustling and scraping on marble.wav, by CVLTIV8R: credit welcomed); 859154 (Loud Bang Crashing Metal Chunk Dropped in Metal Dumpster, by qubodup: CC0 on its page, while its signature points to the CC BY credit on the profile: name qubodup under sounds, so that either reading is met); 861352 (Annoying Voiceover Wet Mouth Clicks, by qubodup: CC0 on its page, while its signature points to the CC BY credit on the profile: name qubodup under sounds, so that either reading is met).

CC0 needs no credit; these are courtesies. Some uploaders only ask to hear where a sound went, by a comment on its page (it takes a Freesound login, so nobody has done it yet): 828623 (c64cosmin), 417537 (danthaiwang), 320913 (mickdow), 634746 (TravieDoodle), 696021 (Funky_Audio), 547976 (trijohnstone), 524807 (SamuelGremaud), 172411 (EagleStealthTeam), 459970 (florianreichelt), 574752 (ericnorcross81), 418487 (dersinnsspace), 719430 (BaggoNotes). felix.blume (684518, 447375, 639332, 217884, 146436) and klankbeeld (611197) invite comments and ratings. Worth keeping a copy of the page: 639332 and 509477 mention faint voices or sparse people outside the stretches used (the spans used were checked by spectrogram, not by ear); 848923 says it was composed of its uploader's recordings in a shopping mall, pitched down, with reverb; 451914 mentions distant noises, of which only the bass under 350 Hz is used; 185059 (whisper_gabble): its uploader does not consent to training generative models; playing it is fine, do not feed it to any such pipeline. RutgerMuller (51153, 104013, 104016, 104019, 104351, 484307) asks that his unedited sounds are not sold on, and that a credit does not read as a collaboration: everything here is cut and filtered.

## CC0 assets: Poly Haven, ambientCG, Freesound

Every model, material and HDRI not covered by the sections above, and not made for this piece, comes from
[Poly Haven](https://polyhaven.com/license) or [ambientCG](https://docs.ambientcg.com/license/), and is
dedicated to the public domain under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Recorded sounds taken from
[Freesound](https://freesound.org) are used only when they carry the same CC0 dedication.

CC0 waives copyright and related rights as far as the law allows: the files may be copied, modified and
redistributed, commercially or not, without permission and without attribution, so no notice is
required. Authors are credited in [ASSET_MANIFEST.md](ASSET_MANIFEST.md) anyway, as a courtesy. A
Freesound recording under any other license (for example CC BY) would need its own attribution here
before it could be added.

## Fonts (redistributed)

Anton, Courier Prime, Protest Revolution and Just Me Again Down Here are under the SIL Open Font License 1.1; Special Elite under the Apache License 2.0.
Their licence files ship verbatim next to them in `public/fonts/`. Sources are listed in ASSET_MANIFEST.md.
