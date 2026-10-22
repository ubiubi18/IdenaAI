{
  description = "Reproducible Linux development and source-runtime packages for IdenaAI";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      node24221For = pkgs: pkgs.nodejs_24.overrideAttrs (_: {
        version = "24.22.1";
        src = pkgs.fetchurl {
          url = "https://nodejs.org/dist/v24.22.1/node-v24.22.1.tar.xz";
          hash = "sha256-T1N5eWKAza6wwvNY/QS2oWzE+336g7WoyRqdljtDUjE=";
        };
      });
      electron4383For = pkgs:
        (pkgs.callPackage (pkgs.path + "/pkgs/development/tools/electron/binary/generic.nix") {})
          "43.8.3" {
            headers = "sha256-cTJbrdyp9H4jd5sS3et2ZBsYFC0ZxdO7xN0dyrlvccw=";
            aarch64-darwin = "sha256-COaTrjbP0jAQWqvnDGJrGiQ8E1NKUpw1qAwbh8uNp7Q=";
            aarch64-linux = "sha256-uBSrIqvwvOkP0v/8FJDvyU84g1O82y90SVB0SZj9l7E=";
            armv7l-linux = "sha256-zmW0ulLavhz46Ykz0FfLZWubnHRawOHIWdMxvHpdoa4=";
            x86_64-linux = "sha256-c9fW/hIMmY23WDTCPIznzoOQYHwZiy4Weiis15N77yI=";
          };
      go12610For = pkgs: pkgs.go_1_26.overrideAttrs (_: {
        version = "1.26.10";
        src = pkgs.fetchurl {
          url = "https://go.dev/dl/go1.26.10.src.tar.gz";
          hash = "sha256-/WPog7ovK/ypPBZGsx6+9j4rHk0rMXyXidl2po2B828=";
        };
      });
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          node24221 = node24221For pkgs;
          electron4383 = electron4383For pkgs;
          go12610 = go12610For pkgs;
          buildGo12610Module = pkgs.buildGoModule.override { go = go12610; };
          idenaWasmBinding = pkgs.fetchFromGitHub {
            owner = "ubiubi18";
            repo = "idena-wasm-binding";
            rev = "01ccca5cc3c94917725964541954a9f20e3412e9";
            hash = "sha256-3mrpSd7yVxY+SanZBdXNC3qljHZmV2BpbhkyRQZgS0w=";
          };
          idenaGo = pkgs.callPackage ./nix/idena-go.nix {
            buildGoModule = buildGo12610Module;
            inherit idenaWasmBinding;
          };
          idenaSocialUi = pkgs.callPackage ./nix/idena-social-ui.nix {
            src = self + "/vendor/idena.social-ui";
            nodejs_24 = node24221;
          };
          idenaai = pkgs.callPackage ./nix/idenaai.nix {
            src = self;
            inherit idenaGo idenaSocialUi;
            nodejs_24 = node24221;
            electron_43 = electron4383;
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
          node24221 = node24221For pkgs;
          go12610 = go12610For pkgs;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              electron_43
              gcc
              git
              gnumake
              go12610
              node24221
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
