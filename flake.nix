{
  description = "Reproducible Linux development and source-runtime packages for IdenaAI";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      go1268For = pkgs: pkgs.go_1_26.overrideAttrs (_: {
        version = "1.26.8";
        src = pkgs.fetchurl {
          url = "https://go.dev/dl/go1.26.8.src.tar.gz";
          hash = "sha256-Tjm5jkL5RvoFrIvFtxh335fb23y7Gnd7VBZnrXEX/S4=";
        };
      });
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          go1268 = go1268For pkgs;
          buildGo1268Module = pkgs.buildGoModule.override { go = go1268; };
          idenaWasmBinding = pkgs.fetchFromGitHub {
            owner = "ubiubi18";
            repo = "idena-wasm-binding";
            rev = "67ba065fdb02aa07cced2a43a261e481ca5b39d9";
            hash = "sha256-CIn3o3Tw9KJuJ5AJ7UMDIq0AkghyLfj4boTJSk5DARA=";
          };
          idenaGo = pkgs.callPackage ./nix/idena-go.nix {
            buildGoModule = buildGo1268Module;
            inherit idenaWasmBinding;
          };
          idenaSocialUi = pkgs.callPackage ./nix/idena-social-ui.nix {
            src = self + "/vendor/idena.social-ui";
          };
          idenaai = pkgs.callPackage ./nix/idenaai.nix {
            src = self;
            inherit idenaGo idenaSocialUi;
          };
        in
        {
          default = idenaai;
          inherit idenaai;
          idena-go = idenaGo;
          idena-social-ui = idenaSocialUi;
        });

      apps = forAllSystems (system:
        let
          package = self.packages.${system}.idenaai;
        in
        {
          default = {
            type = "app";
            program = "${package}/bin/idenaai";
            meta.description = "Run the guarded IdenaAI Linux source runtime";
          };
          idenaai = {
            type = "app";
            program = "${package}/bin/idenaai";
            meta.description = "Run the guarded IdenaAI Linux source runtime";
          };
        });

      checks = forAllSystems (system: {
        inherit (self.packages.${system}) idenaai;
        inherit (self.packages.${system}) idena-go idena-social-ui;
      });

      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          go1268 = go1268For pkgs;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              electron_43
              gcc
              git
              gnumake
              go1268
              nodejs_24
              pkg-config
              python3
            ];
            ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
            NEXT_TELEMETRY_DISABLED = "1";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            shellHook = ''
              echo "IdenaAI Nix shell: Node $(node --version), npm $(npm --version), Go $(go version | cut -d' ' -f3)"
            '';
          };
        });
    };
}
