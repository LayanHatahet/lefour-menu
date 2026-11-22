#!/bin/sh
# Prepare a folder ready for `vercel deploy --prod`.
#
#   sh stage.sh <output-dir> [payload-dir]
#
# The site is static: Vercel runs no build, so the build step has to happen
# here, against a copy. The serverless functions do NOT come from this repo
# but from the deploy payload, which is the only place the admin password
# lives — see ../lefour-deploy-payload/README.txt.
set -e

OUT=${1:?usage: sh stage.sh <output-dir> [payload-dir]}
PAYLOAD=${2:-../lefour-deploy-payload}
HERE=$(cd "$(dirname "$0")" && pwd)

rm -rf "$OUT"
mkdir -p "$OUT"

# the site itself
cp "$HERE/index.html" "$HERE/admin.html" "$HERE/reports.html" "$HERE/merci.html" "$HERE/commande-annulee.html" "$OUT/"
cp -r "$HERE/css" "$HERE/js" "$HERE/assets" "$OUT/"

# functions + routing come from the payload, never from the repo copies
cp -r "$PAYLOAD/api" "$OUT/"
cp "$PAYLOAD/vercel.json" "$OUT/"

# Le lien vers le projet Vercel. Sans lui, `vercel deploy` prend le nom du
# dossier pour un nouveau projet et cree un site parallele au lieu de mettre
# a jour lefourboulangerie.com — c est arrive.
# Il vient du payload, pas du depot : le .vercel versionne pointe encore
# vers l ancien compte Vercel, alors que le site vit sur le compte layan16.
if [ -d "$PAYLOAD/.vercel" ]; then
  cp -r "$PAYLOAD/.vercel" "$OUT/"
else
  echo "WARNING: no .vercel link in $PAYLOAD - deploying would create a NEW project" >&2
fi

# inline the CSS and the menu scripts, write /en and /ar, emit menu-prices.json
( cd "$HERE" && node build-inline.js "$OUT" )

echo "staged -> $OUT"
