// ! Warning:
// ! This benchmark may take 1-2+ minutes. It repeatedly traverses the entire entity list in
// ! Counter-Strike 2, storing it into `EntityClassInfoNames`…

import Memory from 'bun-memory';

// Get the latest client_dll.json and offsets.json from:
// https://github.com/a2x/cs2-dumper/tree/main/output

import ClientDLLJSON from './offsets/client_dll.json';
import OffsetsJSON from './offsets/offsets.json';

const Iterations = 1e6;

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

for (let i = 0; i < Iterations; i++) {
  const GlobalVarsPtr = cs2.u64(ClientPtr + Client.Other.dwGlobalVars);
  /* */ const CurTime = cs2.f32(GlobalVarsPtr + 0x30n);

  const lPlayerControllerPtr = cs2.u64(ClientPtr + Client.Other.dwLocalPlayerController);
  /* */ const lPlayerName = cs2.string(lPlayerControllerPtr + Client.CBasePlayerController.m_iszPlayerName, 32);

  const lPlayerPawnPtr = cs2.u64(ClientPtr + Client.Other.dwLocalPlayerPawn);
  /* */ const lHealth = cs2.u32(lPlayerPawnPtr + Client.C_BaseEntity.m_iHealth);
  /* */ const lTeamNum = cs2.u8(lPlayerPawnPtr + Client.C_BaseEntity.m_iTeamNum);
}

// Create caches and scratches to optimize performance…
const BaseEntityPtrs = new Map<string, bigint[]>();

const EntityChunkScratch = new BigUint64Array(0xe000 / 0x08);
const EntityListScratch = new BigUint64Array(0x200 / 0x08);

const EntityClassInfoNames = new Map<bigint, string>();

// Start the test…
for (let i = 0; i < 5; i++) {
  console.log('Starting the test…');

  const start = performance.now();

  const EntityListPtr = cs2.u64(ClientPtr + Client.Other.dwEntityList);

  for (let j = 0; j < Iterations; j++) {
    try {
      // Traverse the entity list and store it in `BaseEntityPtrs`…
      void cs2.read(EntityListPtr + 0x10n, EntityListScratch);

      // Traverse each of the potential 64 entity chunks…
      for (let k = 0; k < 0x40; k++) {
        const EntityChunkPtr = EntityListScratch[k];

        if (EntityChunkPtr === 0n) {
          continue;
        }

        void cs2.read(EntityChunkPtr, EntityChunkScratch);

        // Traverse the potential 512 entities in that chunk…
        for (let j = 0x00, l = 0x00; j < 0x200; j++, l += 0x0e) {
          const BaseEntityPtr = EntityChunkScratch[l];

          if (BaseEntityPtr === 0n) {
            continue;
          }

          const EntityClassInfoPtr = EntityChunkScratch[l + 0x01];

          let Name = EntityClassInfoNames.get(EntityClassInfoPtr);

          if (Name === undefined) {
            const SchemaClassInfoDataPtr = cs2.u64(EntityClassInfoPtr + 0x30n);
            /* */ const NamePtr = cs2.u64(SchemaClassInfoDataPtr + 0x08n);
            // /*       */ Name = cs2.buffer(NamePtr, 0x20).toString();
            /*       */ Name = cs2.string(NamePtr, 0x40);

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

      // // Log our entities…
      // console.log(
      //   'Entities found this tick: %O',
      //   Object.fromEntries([...BaseEntityPtrs.entries()].map(([Name, { length }]) => [Name, length])) //
      // );

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

  const end = performance.now();

  const total = end - start;
  const average = total / Iterations;

  console.log(
    'Completed %d iterations in %ss, averaging %sms (%sµs) each…', //
    Iterations,
    (total / 1_000).toFixed(2),
    average.toFixed(2),
    (average * 1_000).toFixed(2)
  );
}
