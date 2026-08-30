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
    rev = "eeb73fbaf80493e3bcbc4a661fa3a7e2f07ec2bd";
    hash = "sha256-swiy4fm/6gPNxQm3M1rdOPqzNig0q8KcvNf/HbXBzeU=";
  };

  vendorHash = "sha256-TsXSafgco4H/f/NFE1coNYfhivLMw6hcJuFUH0TzLUk=";
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
