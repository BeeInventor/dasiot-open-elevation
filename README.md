# Open-Elevation

[https://open-elevation.com](https://open-elevation.com)

A free and open-source elevation API.

**Open-Elevation** is a free and open-source alternative to the [Google Elevation API](https://developers.google.com/maps/documentation/elevation/start) and similar offerings.

This service came out of the need to have a hosted, easy to use and easy to setup elevation API. While there are some alternatives out there, none of them work out of the box, and seem to point to dead datasets. <b>Open-Elevation</b> is [easy to setup](https://github.com/Jorl17/open-elevation/blob/master/docs/host-your-own.md), has its own docker image and provides scripts for you to easily acquire whatever datasets you want. We offer you the whole world with our [public API](https://github.com/Jorl17/open-elevation/blob/master/docs/api.md).

If you enjoy our service, please consider [donating to us](https://open-elevation.com#donate). Servers aren't free :)

**API Docs are [available here](https://github.com/Jorl17/open-elevation/blob/master/docs/api.md)**

You can learn more about the project, including its **free public API** in [the website](https://open-elevation.com)

## Donations

Please consider donating to keep the public API alive. This API is **used by millions of users every day** and it costs money to keep running!

You can donate [by following this link](https://www.open-elevation.com/#donate).


## DasIot Started


### Download Taiwan data from 

```
- https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_61_08.zip
- https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_61_07.zip
```

### Create folder

```
mkdir -p data
```

### Copy srtm_61_08.tif, srtm_61_08.tif to data folder

### Start server

```
docker run -t -i -v $(pwd)/data:/code/data -p 80:8080 openelevation/open-elevation
```

### Download selected SRTM regions

```
./download-srtm-data.sh hk
./download-srtm-data.sh tw
./download-srtm-data.sh jp
./download-srtm-data.sh east-asia
```

Supported arguments:

- `world`: original 250m full-world download
- `hk`: Hong Kong
- `tw`: Taiwan main island
- `tw-all`: Taiwan including common outlying islands
- `jp`: Japan
- `east-asia`: Hong Kong + Taiwan + Japan

### Evaluate result

```
curl --location 'https://api.open-elevation.com/api/v1/lookup?locations=25.078984%2C121.529100'

curl --location 'http://localhost:8080/api/v1/lookup?locations=25.078984%2C121.529100'
```

## Local development with venv

```bash
brew install python@3.11 gdal spatialindex
export PATH="/opt/homebrew/opt/python@3.11/bin:/opt/homebrew/opt/gdal/bin:$PATH"
python3.11 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python server.py
```

Notes:

- Python `3.14` is too new for this project's pinned `GDAL==3.3.1` dependency. Use Python `3.10` or `3.11`.
- If `pip install -r requirements.txt` says `gdal-config` is missing, GDAL is not installed or not on your `PATH`.


## Host with Helm

Prepare a values file first. The Helm chart now expects you to provide the elevation datasets you want to host, for example Hong Kong, Taiwan, and Japan.

Example `values-hk-tw-jp.yaml`:

```yaml
persistence:
  enabled: true
  size: 30Gi

dataset:
  enabled: true
  skipIfDataPresent: true
  urls:
    - "https://example.com/hong-kong-dem.zip"
    - "https://example.com/taiwan-dem.zip"
    - "https://example.com/japan-dem.zip"
  tile:
    enabled: true
    xTiles: 10
    yTiles: 10
    removeSourceAfterTiling: true
  cleanupArchives: true
```

Then install with Helm:

```
helm install open-elevation ./charts/open-elevation \
  --namespace open-elevation \
  --create-namespace \
  -f charts/open-elevation/values-east-asia.yaml
```

There is also a repo example you can start from:

```
charts/open-elevation/values-east-asia.yaml
```

Notes:

- `dataset.urls` must point to GeoTIFF-compatible elevation files, either `.zip`, `.rar`, `.tif`, or `.tiff`.
- `persistence.size=5Gi` is usually too small for multiple countries. Increase it based on the datasets you choose.
- For large datasets, keep `tile.enabled: true` so the init container splits the source into smaller GeoTIFF tiles before serving.
- Tiling can take a long time on first startup. For East Asia data with `xTiles: 10` and `yTiles: 10`, the init container may run many `gdal_translate` operations before the main container starts.
- If you already preloaded the PVC with `.tif` files, `skipIfDataPresent: true` avoids re-downloading on restart.
- If you keep the same PVC and later change `dataset.urls`, set `skipIfDataPresent: false` or clear the PVC first, otherwise the init container will keep using the existing files.
- By default, `helm uninstall` will also delete the PVC if the chart created it.

If startup is too slow, you have three practical options:

- Set `dataset.tile.enabled: false` to skip tiling and start faster.
- Reduce `xTiles` and `yTiles` to create fewer output files.
- Pre-download and pre-tile the GeoTIFF files outside Kubernetes, then mount them through an existing PVC.

### Remove Helm release but keep geographic data

To keep downloaded GeoTIFF data, either use your own pre-created PVC with `persistence.existingClaim`, or install with `persistence.keepOnUninstall=true`.

```bash
helm install open-elevation ./charts/open-elevation \
  --namespace open-elevation \
  --create-namespace \
  -f charts/open-elevation/values-east-asia.yaml \
  --set persistence.keepOnUninstall=true

helm uninstall open-elevation -n open-elevation
```

### Remove Helm release and geographic data

This is the default behavior when the chart created the PVC and `persistence.keepOnUninstall=false`.

```bash
helm uninstall open-elevation -n open-elevation
```

If you installed with `persistence.keepOnUninstall=true` and later want to remove the data too:

```bash
helm uninstall open-elevation -n open-elevation
kubectl delete pvc open-elevation -n open-elevation
```
