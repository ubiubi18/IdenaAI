{
  lib,
  buildNpmPackage,
  electron_43,
  makeWrapper,
  nodejs_24,
  pkg-config,
  python3,
  src,
  idenaGo,
  idenaSocialUi,
}:

buildNpmPackage rec {
  pname = "idenaai";
  version = "0.1.0";
  inherit src;

  nodejs = nodejs_24;
  npmDepsHash = "sha256-hyTrEmdvnLae5T4FFaP0JigaMK/1fwV1IITyvLMkTvk=";
  npmFlags = [
    "--ignore-scripts"
    "--legacy-peer-deps"
  ];
  npmBuildScript = "build:renderer";

  nativeBuildInputs = [
    makeWrapper
    pkg-config
    python3
  ];

  env = {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    NEXT_TELEMETRY_DISABLED = "1";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    npm_config_audit = "false";
    npm_config_fund = "false";
  };

  postPatch = ''
    # Flakes include tracked files only, but explicitly remove every dotenv
    # file before dependency installation and renderer compilation as well.
    rm -f .env .env.*
  '';

  preBuild = ''
    appElectron="$(node -p "require('./package.json').devDependencies.electron")"
    if [ "''${appElectron%%.*}" != "${lib.versions.major electron_43.version}" ]; then
      echo "IdenaAI expects Electron major ''${appElectron%%.*}, but Nix provides ${electron_43.version}" >&2
      exit 1
    fi

    rm -rf vendor/idena.social-ui/dist renderer/public/idena-social
    mkdir -p vendor/idena.social-ui/dist renderer/public/idena-social
    cp -R ${idenaSocialUi}/share/idena-social/. vendor/idena.social-ui/dist/
    cp -R ${idenaSocialUi}/share/idena-social/. renderer/public/idena-social/
    chmod -R u+w vendor/idena.social-ui/dist renderer/public/idena-social

    export HOME="$TMPDIR/idenaai-home"
    mkdir -p "$HOME"
    nodeGyp="$PWD/node_modules/node-gyp/bin/node-gyp.js"
    test -f "$nodeGyp"

    for module in leveldown; do
      moduleDir="$PWD/node_modules/$module"
      test -d "$moduleDir"
      (
        cd "$moduleDir"
        node "$nodeGyp" rebuild \
          --nodedir=${electron_43.headers} \
          --target=${electron_43.version} \
          --runtime=electron
      )
    done

    test -f node_modules/leveldown/build/Release/leveldown.node

    mkdir -p build/node/current
    cp ${idenaGo}/bin/idena-go build/node/current/idena-go
    chmod 0755 build/node/current/idena-go
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    ./node_modules/.bin/jest \
      scripts/runtime-safety.test.js \
      scripts/start-electron-static.test.js \
      --runInBand
    ./node_modules/.bin/eslint \
      scripts/runtime-safety.js \
      scripts/runtime-safety.test.js \
      scripts/start-electron-static.js \
      scripts/start-electron-static.test.js
    runHook postCheck
  '';

  preInstall = ''
    # The renderer is static at runtime. Keep only main-process production
    # dependencies instead of shipping Next.js, Jest, Electron Builder, etc.
    npm prune --omit=dev --ignore-scripts --legacy-peer-deps

    nativeModule=node_modules/leveldown/build/Release/leveldown.node
    test -f "$nativeModule"
    cp "$nativeModule" "$TMPDIR/leveldown.node"
    rm -rf node_modules/leveldown/build node_modules/leveldown/prebuilds
    mkdir -p node_modules/leveldown/build/Release
    cp "$TMPDIR/leveldown.node" "$nativeModule"
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/libexec/idenaai" "$out/bin"
    cp -R . "$out/libexec/idenaai/"
    rm -f "$out/libexec/idenaai"/.env "$out/libexec/idenaai"/.env.*
    rm -rf "$out/libexec/idenaai/renderer/.next"

    makeWrapper ${nodejs_24}/bin/node "$out/bin/idenaai" \
      --add-flags "$out/libexec/idenaai/scripts/start-electron-static.js" \
      --set ELECTRON_SKIP_BINARY_DOWNLOAD 1 \
      --set IDENAAI_ELECTRON_BIN ${electron_43}/bin/electron \
      --set NEXT_TELEMETRY_DISABLED 1 \
      --set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 1
    runHook postInstall
  '';

  meta = {
    description = "IdenaAI source runtime with pinned node and social UI";
    homepage = "https://github.com/ubiubi18/IdenaAI";
    license = lib.licenses.mit;
    mainProgram = "idenaai";
    platforms = lib.platforms.linux;
  };
}
