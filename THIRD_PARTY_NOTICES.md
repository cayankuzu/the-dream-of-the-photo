# Third-party notices

The Dream of the Photo ships, or downloads at run time, the third-party material listed below. Each
asset file is listed individually in [ASSET_MANIFEST.md](ASSET_MANIFEST.md).

## Microsoft Rocketbox (MIT)

The photographer (`public/models/photographer.glb`) is converted from the Microsoft Rocketbox avatar
library: avatar `Male_Adult_07` and the animations `m_idle_breathe_01` and `m_take_picture`.

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

## CC0 assets: Poly Haven, ambientCG, Freesound

All models, materials and HDRIs other than the photographer come from
[Poly Haven](https://polyhaven.com/license) and [ambientCG](https://docs.ambientcg.com/license/), and are
dedicated to the public domain under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Recorded sounds taken from
[Freesound](https://freesound.org) are used only when they carry the same CC0 dedication.

CC0 waives copyright and related rights as far as the law allows: the files may be copied, modified and
redistributed, commercially or not, without permission and without attribution, so no notice is
required. Authors are credited in [ASSET_MANIFEST.md](ASSET_MANIFEST.md) anyway, as a courtesy. A
Freesound recording under any other license (for example CC BY) would need its own attribution here
before it could be added.

## Fonts (redistributed)

Latin subsets of three typefaces (and the latin-ext subsets of Cormorant Garamond and IBM Plex Mono, for Turkish) are self-hosted in `public/fonts/` (WOFF2, from Google Fonts) and ship
with the build, each next to its license:

| Typeface | Files | Designer | License | License file |
| --- | --- | --- | --- | --- |
| Cormorant Garamond | `cormorant-garamond-400{,-italic}.woff2`, `cormorant-garamond-400{,-italic}-latin-ext.woff2` | Christian Thalmann | SIL Open Font License 1.1 | `public/fonts/OFL-CormorantGaramond.txt` |
| IBM Plex Mono | `ibm-plex-mono-400{,-latin-ext}.woff2` | Mike Abbink, Bold Monday (for IBM) | SIL Open Font License 1.1 | `public/fonts/OFL-IBMPlexMono.txt` |
| Homemade Apple | `homemade-apple-400.woff2` | Font Diner | Apache License 2.0 | `public/fonts/LICENSE-HomemadeApple.txt` |

The fonts are unmodified apart from Google Fonts' subsetting; the OFL fonts are not sold on their own and
keep their reserved names.
