// tz-lookup ships no types. It's a single default-exported function mapping a
// coordinate to its IANA timezone name (offline; bundled boundary data).
declare module "tz-lookup" {
  const tzLookup: (lat: number, lng: number) => string;
  export default tzLookup;
}
