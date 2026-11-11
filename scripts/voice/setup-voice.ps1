# Sets up what scripts/voice/build-voice.py needs, all of it under .asset-cache\voice (gitignored):
#   python312\   a private CPython 3.12 (the engines do not all run on 3.13 yet)
#   venv\        the virtual environment the build runs under
#   models\      the weights, about 12 GB
# Nothing is installed outside that folder and nothing needs an account. Run it from the repository root:
#   powershell -ExecutionPolicy Bypass -File scripts\voice\setup-voice.ps1
# It can be run again: what is already there is kept.
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
$V = Join-Path $root ".asset-cache\voice"
New-Item -ItemType Directory -Force "$V\models", "$V\dl", "$V\pip-cache" | Out-Null
$env:PIP_CACHE_DIR = "$V\pip-cache"

# 1. CPython 3.12, the standalone build published on GitHub by astral-sh/python-build-standalone (PSF licence)
if (-not (Test-Path "$V\python312\python.exe")) {
    $url = "https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.12.16%2B20261110-x86_64-pc-windows-msvc-install_only.tar.gz"
    $tgz = "$V\dl\py312.tar.gz"
    curl.exe -sL -o $tgz $url
    $sha = (Get-FileHash $tgz -Algorithm SHA256).Hash.ToLower()
    if ($sha -ne "e23fe5b16926de1d81661b1a97352e89fb167549c55a6825796ccd0f32ec7f1b") { throw "python archive: wrong checksum $sha" }
    New-Item -ItemType Directory -Force "$V\python312" | Out-Null
    tar.exe -xzf $tgz -C "$V\python312" --strip-components=1
}

# 2. the virtual environment
if (-not (Test-Path "$V\venv\Scripts\python.exe")) { & "$V\python312\python.exe" -I -m venv "$V\venv" }
$py = "$V\venv\Scripts\python.exe"

# 3. PyTorch built for CUDA 12.8 (an RTX 50 card needs it; it also runs on the CPU). This one wheel comes from the
#    PyTorch project's own index, not from PyPI: PyPI only carries the CPU build for Windows.
& $py -I -m pip install --no-input torch==2.8.0+cu128 torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128 --extra-index-url https://pypi.org/simple
# 4. everything else, pinned (PyPI); the two engines without their own pins, which ask for an older torch
& $py -I -m pip install --no-input -r "$PSScriptRoot\requirements.txt"
& $py -I -m pip install --no-input --no-deps voxcpm==2.0.3 s3tokenizer==0.3.0 "chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@ab55923c27757c90cfcc407baa57dc25a7d25217"

# 5. the weights, each from the Hugging Face repository of its own project, at a pinned revision
function Fetch($repo, $rev, $dir, $files) {
    foreach ($f in $files) {
        $out = Join-Path "$V\models\$dir" $f
        if (Test-Path $out) { continue }
        New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
        curl.exe -sL --retry 5 -o $out "https://huggingface.co/$repo/resolve/$rev/$f"
    }
}
Fetch "openbmb/VoxCPM2" "7936080b41163874f38610f46f438e2c0757f9fd" "VoxCPM2" @("config.json", "special_tokens_map.json", "tokenization_voxcpm2.py", "tokenizer.json", "tokenizer_config.json", "README.md", "audiovae.pth", "model.safetensors")
Fetch "ResembleAI/chatterbox" "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18" "chatterbox" @("ve.pt", "conds.pt", "grapheme_mtl_merged_expanded_v1.json", "Cangjie5_TC.json", "README.md", "s3gen.pt", "t3_mtl23ls_v3.safetensors")
Fetch "Systran/faster-whisper-large-v3" "edaa852ec7e145841d8ffdb056a99866b5f0a478" "faster-whisper-large-v3" @("README.md", "config.json", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "model.bin")
# the naturalness predictor (tarepan/SpeechMOS, GitHub) is fetched by torch.hub into models\torch on the first build

& $py -I -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
Write-Host "ready: $py scripts\voice\build-voice.py --lines <lines.json> --out <folder>"
