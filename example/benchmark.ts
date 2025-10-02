// ! Warning:
// ! This benchmark may take 1-2+ minutes. It repeatedly traverses the entire entity list in
// ! Counter-Strike 2, storing it into `EntityClassInfoNames`…

import Memory from 'bun-memory';

// Get the latest client_dll.json and offsets.json from:
// https://github.com/a2x/cs2-dumper/tree/main/output

import ClientDLLJSON from './offsets/client_dll.json';
import OffsetsJSON from './offsets/offsets.json';

// Load the needed offsets as bigints… It's ugly but… IntelliSense! 🫠…
const Client = {
  ...Object.fromEntries(Object.entries(ClientDLLJSON['client.dll'].classes).map(([class_, { fields }]) => [class_, Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, BigInt(value)]))])),
  Other: Object.fromEntries(Object.entries(OffsetsJSON['client.dll']).map(([key, value]) => [key, BigInt(value)])),
} as {
  [Class in keyof (typeof ClientDLLJSON)['client.dll']['classes']]: { [Field in keyof (typeof ClientDLLJSON)['client.dll']['classes'][Class]['fields']]: bigint };
} & { Other: { [K in keyof (typeof OffsetsJSON)['client.dll']]: bigint } };

// Open a handle to cs2.exe…
const cs2 = new Memory('cs2.exe');

// Get the base for client.dll…
const ClientPtr = cs2.modules['client.dll']?.base;

// Make sure client.dll is loaded…
if (ClientPtr === undefined) {
  throw new TypeError('ClientPtr must not be undefined.');
}

// Warmup…
console.log('Warming up…');

for (let i = 0; i < 1e6; i++) {
  const GlobalVarsPtr = cs2.u64(ClientPtr + Client.Other.dwGlobalVars);
  /* */ const CurTime = cs2.f32(GlobalVarsPtr + 0x30n);
}

// Create caches and scratches to optimize performance…
const Cache_Names = new Map<bigint, string>();

const EntityChunkScratch = new BigUint64Array(0xf000 / 0x08);
const EntityListScratch = new BigUint64Array(0x200 / 0x08);

// Start the test…
console.log('Starting the test…');

const performance1 = performance.now();

const EntityListPtr = cs2.u64(ClientPtr + Client.Other.dwEntityList);

for (let i = 0; i < 1e6; i++) {
  const EntityClassInfoNames = new Map<string, bigint[]>();
  const EntityClassInfoPtrs = new Map<bigint, bigint[]>();

  // Traverse the entity list…
  cs2.read(EntityListPtr + 0x10n, EntityListScratch);

  for (let i = 0; i < 0x40; i++) {
    const EntityChunkPtr = EntityListScratch[i];

    if (EntityChunkPtr === 0n) {
      continue;
    }

    cs2.read(EntityChunkPtr, EntityChunkScratch);

    for (let j = 0, l = 0; j < 0x200; j++, l += 0x0f) {
      const BaseEntityPtr = EntityChunkScratch[l];

      if (BaseEntityPtr === 0n) {
        continue;
      }

      const EntityClassInfoPtr = EntityChunkScratch[l + 0x01];

      let BaseEntityPtrs = EntityClassInfoPtrs.get(EntityClassInfoPtr);

      if (BaseEntityPtrs === undefined) {
        BaseEntityPtrs = [];

        EntityClassInfoPtrs.set(EntityClassInfoPtr, BaseEntityPtrs);
      }

      BaseEntityPtrs.push(BaseEntityPtr);
    }

    for (const [EntityClassInfoPtr, BaseEntityPtrs] of EntityClassInfoPtrs) {
      let Name = Cache_Names.get(EntityClassInfoPtr);

      if (Name === undefined) {
        const SchemaClassInfoDataPtr = cs2.u64(EntityClassInfoPtr + 0x30n);
        /* */ const NamePtr = cs2.u64(SchemaClassInfoDataPtr + 0x08n);
        /*       */ Name = cs2.cString(NamePtr, 0x2a).toString();

        Cache_Names.set(EntityClassInfoPtr, Name);
      }

      EntityClassInfoNames.set(Name, BaseEntityPtrs);
    }
  }
}

const performance2 = performance.now();

console.log('Test completed in %fms…', (performance2 - performance1).toFixed(2));
