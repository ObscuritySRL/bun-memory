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

  const lPlayerControllerPtr = cs2.u64(ClientPtr + Client.Other.dwLocalPlayerController);

  const lPlayerPawnPtr = cs2.u64(ClientPtr + Client.Other.dwLocalPlayerPawn);
  /* */ const lHealth = cs2.u32(lPlayerPawnPtr + Client.C_BaseEntity.m_iHealth);
  /* */ const lTeamNum = cs2.u8(lPlayerPawnPtr + Client.C_BaseEntity.m_iTeamNum);
}

// Create caches and scratches to optimize performance…
const BaseEntityPtrs = new Map<string, bigint[]>();

const EntityChunkScratch = new BigUint64Array(0xf000 / 0x08);
const EntityListScratch = new BigUint64Array(0x200 / 0x08);

const EntityClassInfoNames = new Map<bigint, string>();

// Start the test…
console.log('Starting the test…');

const performance1 = performance.now();

const EntityListPtr = cs2.u64(ClientPtr + Client.Other.dwEntityList);

for (let i = 0; i < 1e6; i++) {
  try {
    // Traverse the entity list and store it in `BaseEntityPtrs`…
    cs2.read(EntityListPtr + 0x10n, EntityListScratch);

    // Traverse each of the potential 64 entity chunks…
    for (let i = 0; i < 0x40; i++) {
      const EntityChunkPtr = EntityListScratch[i];

      if (EntityChunkPtr === 0n) {
        continue;
      }

      cs2.read(EntityChunkPtr, EntityChunkScratch);

      // Traverse each of the potential 512 entities within this chunk…
      // for (let j = 0, l = 0; j < 0x200; j++, l += 0x0f) {
      for (let l = 0; l < 0x1e00; l += 0x0f) {
        const BaseEntityPtr = EntityChunkScratch[l];

        if (BaseEntityPtr === 0n) {
          continue;
        }

        const EntityClassInfoPtr = EntityChunkScratch[l + 0x01];

        let Name = EntityClassInfoNames.get(EntityClassInfoPtr);

        if (Name === undefined) {
          const SchemaClassInfoDataPtr = cs2.u64(EntityClassInfoPtr + 0x30n);
          /* */ const NamePtr = cs2.u64(SchemaClassInfoDataPtr + 0x08n);
          /*       */ Name = cs2.buffer(NamePtr, 0x20).toString();

          EntityClassInfoNames.set(EntityClassInfoPtr, Name);
        }

        let BaseEntityPtrs_ = BaseEntityPtrs.get(Name);

        if (BaseEntityPtrs_ === undefined) {
          BaseEntityPtrs_ = [];

          BaseEntityPtrs.set(Name, BaseEntityPtrs_);
        }

        BaseEntityPtrs_.push(BaseEntityPtr);
      }
    }

    // ! —————————————————————————————————————————————————————————————————————————————————————————————
    // ! YOUR CODE GOES HERE…
    // ! —————————————————————————————————————————————————————————————————————————————————————————————

    // ! —————————————————————————————————————————————————————————————————————————————————————————————
    // ! YOUR CODE ENDS HERE…
    // ! —————————————————————————————————————————————————————————————————————————————————————————————
  } finally {
    // Clear the entity list…
    for (const BaseEntityPtrs_ of BaseEntityPtrs.values()) {
      BaseEntityPtrs_.length = 0;
    }
  }
}

const performance2 = performance.now();

console.log('Test completed in %fms…', (performance2 - performance1).toFixed(2));
