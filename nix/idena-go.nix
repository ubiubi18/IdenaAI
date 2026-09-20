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
    rev = "c478705fedf60c16f721482898b9081ad9d56580";
    hash = "sha256-lZMC7X4WjaRfUItIQYjNm41woUdmB2b4ehB58w0vz4k=";
  };

  vendorHash = "sha256-YTaXY55mqIXtzPS20S8GtgvYICudaSoHJKhpx8YlJh4=";
  subPackages = [ "." ];

  postPatch = ''
    cp -R --no-preserve=mode,ownership ${idenaWasmBinding} idena-wasm-binding
    chmod -R u+w idena-wasm-binding
    substituteInPlace go.mod \
      --replace-fail \
        "replace github.com/idena-network/idena-wasm-binding => github.com/ubiubi18/idena-wasm-binding v0.0.0-20260710141316-67ba065fdb02" \
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
