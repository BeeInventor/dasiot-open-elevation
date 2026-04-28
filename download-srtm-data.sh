#!/usr/bin/env bash

set -eu

BASE_5X5_URL="https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF"
BASE_250M_URL="https://srtm.csi.cgiar.org/wp-content/uploads/files/250m"
DATASET="${1:-world}"
WGET_PROGRESS="${WGET_PROGRESS:-bar:force:noscroll}"
TOTAL_DOWNLOADS=0
CURRENT_DOWNLOAD=0

download_and_extract() {
    local url="$1"
    local file

    file=$(basename "$url")
    CURRENT_DOWNLOAD=$((CURRENT_DOWNLOAD + 1))
    echo "[$CURRENT_DOWNLOAD/$TOTAL_DOWNLOADS] Downloading $file"
    wget --progress="$WGET_PROGRESS" --show-progress -O "$file" "$url"

    case "$file" in
        *.zip|*.ZIP)
            unzip -o "$file"
            ;;
        *.rar|*.RAR)
            unar -f "$file"
            ;;
        *)
            echo "Unsupported archive: $file" >&2
            exit 1
            ;;
    esac
}

download_tile() {
    local tile="$1"
    download_and_extract "$BASE_5X5_URL/$tile.zip"
}

case "$DATASET" in
    world)
        TOTAL_DOWNLOADS=3
        ;;
    hk|hong-kong)
        TOTAL_DOWNLOADS=1
        ;;
    tw|taiwan)
        TOTAL_DOWNLOADS=2
        ;;
    tw-all|taiwan-all)
        TOTAL_DOWNLOADS=4
        ;;
    jp|japan)
        TOTAL_DOWNLOADS=13
        ;;
    east-asia|hk-tw-jp)
        TOTAL_DOWNLOADS=18
        ;;
    *)
        echo "Usage: $0 [world|hk|tw|tw-all|jp|east-asia]" >&2
        exit 1
        ;;
esac

case "$DATASET" in
    world)
        download_and_extract "$BASE_250M_URL/SRTM_NE_250m_TIF.rar"
        download_and_extract "$BASE_250M_URL/SRTM_SE_250m_TIF.rar"
        download_and_extract "$BASE_250M_URL/SRTM_W_250m_TIF.rar"
        ;;
    hk|hong-kong)
        download_tile "srtm_59_08"
        ;;
    tw|taiwan)
        download_tile "srtm_61_07"
        download_tile "srtm_61_08"
        ;;
    tw-all|taiwan-all)
        download_tile "srtm_60_07"
        download_tile "srtm_60_08"
        download_tile "srtm_61_07"
        download_tile "srtm_61_08"
        ;;
    jp|japan)
        download_tile "srtm_62_07"
        download_tile "srtm_62_06"
        download_tile "srtm_63_06"
        download_tile "srtm_63_05"
        download_tile "srtm_63_04"
        download_tile "srtm_64_06"
        download_tile "srtm_64_05"
        download_tile "srtm_64_04"
        download_tile "srtm_65_07"
        download_tile "srtm_65_05"
        download_tile "srtm_65_04"
        download_tile "srtm_65_03"
        download_tile "srtm_66_04"
        ;;
    east-asia|hk-tw-jp)
        download_tile "srtm_59_08"
        download_tile "srtm_60_07"
        download_tile "srtm_60_08"
        download_tile "srtm_61_07"
        download_tile "srtm_61_08"
        download_tile "srtm_62_07"
        download_tile "srtm_62_06"
        download_tile "srtm_63_06"
        download_tile "srtm_63_05"
        download_tile "srtm_63_04"
        download_tile "srtm_64_06"
        download_tile "srtm_64_05"
        download_tile "srtm_64_04"
        download_tile "srtm_65_07"
        download_tile "srtm_65_05"
        download_tile "srtm_65_04"
        download_tile "srtm_65_03"
        download_tile "srtm_66_04"
        ;;
    *)
        echo "Usage: $0 [world|hk|tw|tw-all|jp|east-asia]" >&2
        exit 1
        ;;
esac
