const CHINA_MIN_LNG = 72.004;
const CHINA_MAX_LNG = 137.8347;
const CHINA_MIN_LAT = 0.8293;
const CHINA_MAX_LAT = 55.8271;
const EARTH_AXIS = 6378245.0;
const ECCENTRICITY = 0.006693421622965943;

export function wgs84ToGcj02(position: [number, number]): [number, number] {
  const [longitude, latitude] = position;

  if (isOutsideChina(longitude, latitude)) {
    return position;
  }

  let dLat = transformLatitude(longitude - 105.0, latitude - 35.0);
  let dLng = transformLongitude(longitude - 105.0, latitude - 35.0);
  const radLat = (latitude / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ECCENTRICITY * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180.0) / (((EARTH_AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((EARTH_AXIS / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return [longitude + dLng, latitude + dLat];
}

function isOutsideChina(longitude: number, latitude: number) {
  return (
    longitude < CHINA_MIN_LNG ||
    longitude > CHINA_MAX_LNG ||
    latitude < CHINA_MIN_LAT ||
    latitude > CHINA_MAX_LAT
  );
}

function transformLatitude(x: number, y: number) {
  let result =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  result += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  result += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  result += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return result;
}

function transformLongitude(x: number, y: number) {
  let result =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  result += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  result += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  result += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return result;
}
