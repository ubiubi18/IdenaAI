{
  lib,
  buildNpmPackage,
  nodejs_24,
  src,
}:

buildNpmPackage {
  pname = "idena-social-ui";
  version = "12.8.0";
  inherit src;

  nodejs = nodejs_24;
  npmDepsHash = "sha256-5Fp21g4XKdC7PSFb7Zbi+LyOBcMmjjgSrWDeAAHWbWA=";
  npmBuildScript = "build";

  env = {
    npm_config_audit = "false";
    npm_config_fund = "false";
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/idena-social"
    cp -R dist/. "$out/share/idena-social/"
    runHook postInstall
  '';

  meta = {
    description = "Pinned idena.social web UI embedded by IdenaAI";
    homepage = "https://github.com/N3CR0M4NC3R-dev/idena.social-ui";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
  };
}
