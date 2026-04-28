#!/bin/sh

set -eu

DATA_DIR="${DATA_DIR:-/code/data}"
TMP_DIR="${TMP_DIR:-/tmp/elevation-src}"
SKIP_IF_DATA_PRESENT="${SKIP_IF_DATA_PRESENT:-true}"
TILE_ENABLED="${TILE_ENABLED:-true}"
X_TILES="${X_TILES:-10}"
Y_TILES="${Y_TILES:-10}"
REMOVE_SOURCE_AFTER_TILING="${REMOVE_SOURCE_AFTER_TILING:-true}"
CLEANUP_ARCHIVES="${CLEANUP_ARCHIVES:-true}"
WGET_PROGRESS="${WGET_PROGRESS:-bar:force:noscroll}"

DATASET_URLS="
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_59_08.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_61_07.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_61_08.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_60_07.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_60_08.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_62_07.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_62_06.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_63_06.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_63_05.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_63_04.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_64_06.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_64_05.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_64_04.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_65_07.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_65_05.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_65_04.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_65_03.zip
https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_66_04.zip
"

TOTAL_URLS=$(printf '%s\n' "$DATASET_URLS" | sed '/^$/d' | wc -l | tr -d ' ')

mkdir -p "$DATA_DIR" "$TMP_DIR"

if [ "$SKIP_IF_DATA_PRESENT" = "true" ]; then
  tif_count=$(find "$DATA_DIR" -maxdepth 1 -name '*.tif' | wc -l | tr -d ' ')
  summary_file="$DATA_DIR/summary.json"

  if [ "$TILE_ENABLED" = "true" ]; then
    expected_tif_count=$((TOTAL_URLS * X_TILES * Y_TILES))
  else
    expected_tif_count=$TOTAL_URLS
  fi

  if [ -f "$summary_file" ] && [ "$tif_count" -ge "$expected_tif_count" ]; then
    echo "GeoTIFF dataset already exists in $DATA_DIR ($tif_count files), skipping download."
    exit 0
  fi

  echo "Existing dataset in $DATA_DIR is incomplete ($tif_count/$expected_tif_count tif files); rebuilding."
fi

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

download_and_extract() {
  url="$1"
  index="$2"
  total="$3"
  file="$TMP_DIR/source-$index"
  archive_name=$(basename "$url")

  echo "[$((index + 1))/$total] Downloading $archive_name"
  wget --progress="$WGET_PROGRESS" --show-progress -O "$file" "$url"

  case "$url" in
    *.zip)
      unzip -o "$file" -d "$TMP_DIR"
      ;;
    *.rar)
      unar -f -o "$TMP_DIR" "$file"
      ;;
    *.tif|*.tiff)
      cp "$file" "$TMP_DIR/source-$index.tif"
      ;;
    *)
      echo "Unsupported dataset URL: $url" >&2
      exit 1
      ;;
  esac
}

current_index=0
printf '%s\n' "$DATASET_URLS" | sed '/^$/d' | while IFS= read -r url; do
  download_and_extract "$url" "$current_index" "$TOTAL_URLS"
  current_index=$((current_index + 1))
done

find "$TMP_DIR" -maxdepth 1 \( -iname '*.tif' -o -iname '*.tiff' \) -print

if [ "$TILE_ENABLED" = "true" ]; then
  echo "Tiling GeoTIFF files..."
  for tif in "$TMP_DIR"/*.tif "$TMP_DIR"/*.tiff; do
    [ -e "$tif" ] || continue
    echo "Tiling $(basename "$tif") with ${X_TILES}x${Y_TILES} tiles..."
    /code/create-tiles.sh "$tif" "$X_TILES" "$Y_TILES"
    echo "Finished tiling $(basename "$tif")"
    if [ "$REMOVE_SOURCE_AFTER_TILING" = "true" ]; then
      rm -f "$tif"
    fi
  done
fi

cp -f "$TMP_DIR"/*.tif "$DATA_DIR"/ 2>/dev/null || true
cp -f "$TMP_DIR"/*.tiff "$DATA_DIR"/ 2>/dev/null || true

if [ "$CLEANUP_ARCHIVES" = "true" ]; then
  rm -rf "$TMP_DIR"
fi

echo "Prepared elevation files in $DATA_DIR:"
ls -la "$DATA_DIR"
