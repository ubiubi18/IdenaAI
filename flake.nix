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
            rev = "01ccca5cc3c94917725964541954a9f20e3412e9";
            hash = "sha256-3mrpSd7yVxY+SanZBdXNC3qljHZmV2BpbhkyRQZgS0w=";
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
