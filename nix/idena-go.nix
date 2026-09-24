{
  lib,
  buildGoModule,
  fetchFromGitHub,
  idenaWasmBinding,
}:

buildGoModule rec {
  pname = "idena-go";
  version = "1.1.2";

  src = fetchFromGitHub {
    owner = "ubiubi18";
    repo = "idena-go";
    rev = "e575fd311c46e8d8fedd769b50cab535047f2d49";
    hash = "sha256-AgGBzNf5j4OOLgsuojj7MTDegwOgF5ddv4at1AWoUr8=";
  };

  vendorHash = "sha256-GsirT/3P59r6sBi4B/6KAmk/x2PkG4yu98DtLfyEEOg=";
  subPackages = [ "." ];

  postPatch = ''
    cp -R --no-preserve=mode,ownership ${idenaWasmBinding} idena-wasm-binding
    chmod -R u+w idena-wasm-binding
    substituteInPlace go.mod \
      --replace-fail \
        "replace github.com/idena-network/idena-wasm-binding => github.com/ubiubi18/idena-wasm-binding v0.0.0-20260923235352-01ccca5cc3c9" \
        "replace github.com/idena-network/idena-wasm-binding => ./idena-wasm-binding"
  '';

  preBuild = ''
    (
      cd idena-wasm-binding/lib
      sha256sum --check SHA256SUMS
    )
  '';

  ldflags = [
    "-s"
    "-w"
    "-X main.version=${version}"
  ];

  # The desktop package verifies the binary version below. The upstream test
  # suite includes integration and network-sensitive packages and is kept out
  # of the package build; repository CI remains responsible for those tests.
  doCheck = false;

  postInstall = ''
    "$out/bin/idena-go" --version 2>&1 | grep -F "${version}" >/dev/null
  '';

  meta = {
    description = "Pinned Idena node used by IdenaAI";
    homepage = "https://github.com/ubiubi18/idena-go";
    license = lib.licenses.lgpl3Only;
    mainProgram = "idena-go";
    platforms = lib.platforms.linux;
  };
}
