import { FFIType, dlopen, ptr } from 'bun:ffi';
import { sleep } from 'bun';

import Memory from 'bun-memory';

// Get the latest client_dll.json and offsets.json from:
// https://github.com/a2x/cs2-dumper/tree/main/output

import ClientDLLJSON from './offsets/client_dll.json';
import OffsetsJSON from './offsets/offsets.json';

const { random } = Math;

const Delay = 2.5;

// Load user32.dll…
const {
  symbols: { mouse_event },
} = dlopen('user32.dll', {
  mouse_event: { args: [FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u64], returns: FFIType.void },
});

// Load the needed offsets as bigints…
const Client = {
  ...Object.fromEntries(Object.entries(ClientDLLJSON['client.dll'].classes).map(([class_, { fields }]) => [class_, Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, BigInt(value)]))])),
  Other: Object.fromEntries(Object.entries(OffsetsJSON['client.dll']).map(([key, value]) => [key, BigInt(value)])),
} as {
  [Class in keyof (typeof ClientDLLJSON)['client.dll']['classes']]: { [Field in keyof (typeof ClientDLLJSON)['client.dll']['classes'][Class]['fields']]: bigint };
} & { Other: { [K in keyof (typeof OffsetsJSON)['client.dll']]: bigint } };

// Open a handle to cs2.exe…
const cs2 = new Memory('cs2.exe');

// Get the base for client.dll…
const client = cs2.modules['client.dll'];

if (client === undefined) {
  throw new TypeError('client must not be undefined.');
}

const ClientPtr = client.base;

// Create a cache for class name strings… 🫠…
const Cache_Names = new Map<bigint, string>();

let ticks = 0;

async function tick(ClientPtr: bigint) {
  try {
    ticks++;

    // Read relevant info from memory…
    const GlobalVarsPtr = cs2.u64(ClientPtr + Client.Other.dwGlobalVars);
    /* */ const CurTime = cs2.f32(GlobalVarsPtr + 0x30n);

    const Local_PlayerControllerPtr = cs2.u64(ClientPtr + Client.Other.dwLocalPlayerController);
    /* */ const Local_TickBase = cs2.u32(Local_PlayerControllerPtr + Client.CBasePlayerController.m_nTickBase);

    const Local_PlayerPawnPtr = cs2.u64(ClientPtr + Client.Other.dwLocalPlayerPawn);
    /* */ const Local_FlashOverlayAlpha = cs2.f32(Local_PlayerPawnPtr + Client.C_CSPlayerPawnBase.m_flFlashOverlayAlpha);
    /* */ const Local_IDEntIndex = cs2.i32(Local_PlayerPawnPtr + Client.C_CSPlayerPawn.m_iIDEntIndex);
    /* */ const Local_IsScoped = cs2.i32(Local_PlayerPawnPtr + Client.C_CSPlayerPawn.m_bIsScoped);
    /* */ const Local_Player_WeaponServicesPtr = cs2.u64(Local_PlayerPawnPtr + Client.C_BasePlayerPawn.m_pWeaponServices);
    /*       */ const Local_NextAttack = cs2.f32(Local_Player_WeaponServicesPtr + Client.CCSPlayer_WeaponServices.m_flNextAttack);
    /* */ const Local_TeamNum = cs2.u8(Local_PlayerPawnPtr + Client.C_BaseEntity.m_iTeamNum);
    /* */ const Local_WeaponBasePtr = cs2.u64(Local_PlayerPawnPtr + Client.C_CSPlayerPawn.m_pClippingWeapon);
    /*       */ const Local_Clip1 = cs2.i32(Local_WeaponBasePtr + Client.C_BasePlayerWeapon.m_iClip1);
    /*       */ const Local_NextPrimaryAttackTick = cs2.u32(Local_WeaponBasePtr + Client.C_BasePlayerWeapon.m_nNextPrimaryAttackTick);
    /*       */ const Local_WeaponBaseVDataPtr = cs2.u64(Local_WeaponBasePtr + Client.C_BaseEntity.m_nSubclassID + 0x08n);
    /*             */ const Local_IsFullAuto = cs2.bool(Local_WeaponBaseVDataPtr + Client.CCSWeaponBaseVData.m_bIsFullAuto);
    /*             */ const Local_WeaponType = cs2.i32(Local_WeaponBaseVDataPtr + Client.CCSWeaponBaseVData.m_WeaponType);
    /*       */ const Local_ZoomLevel = cs2.i32(Local_WeaponBasePtr + Client.C_CSWeaponBaseGun.m_zoomLevel);

    // Conditions where we should not fire…
    if (CurTime < Local_NextAttack) {
      return;
    } else if (Local_Clip1 === 0) {
      return;
    } else if (Local_FlashOverlayAlpha >= 0.75) {
      return;
    } else if (Local_IDEntIndex === -1) {
      return;
    } else if (Local_NextPrimaryAttackTick > Local_TickBase) {
      return;
    } else if (Local_WeaponType === 0 || (Local_WeaponType === 5 && !(Local_IsScoped && Local_ZoomLevel !== 0)) || Local_WeaponType === 7 || Local_WeaponType === 9) {
      return;
    }

    // Weapon types: https://swiftlys2.net/sdk/cs2/types/csweapontype

    // Get the entity that we're aiming at from the entity list…
    const EntityListPtr = cs2.u64(ClientPtr + Client.Other.dwEntityList);
    /* */ const EntityChunkPtr = cs2.u64(EntityListPtr + (BigInt(Local_IDEntIndex) >> 0x09n) * 0x08n + 0x10n);
    /*       */ const BaseEntityPtr = cs2.u64(EntityChunkPtr + (BigInt(Local_IDEntIndex) & 0x1ffn) * 0x70n);
    /*             */ const EntityClassInfoPtr = cs2.u64(EntityChunkPtr + (BigInt(Local_IDEntIndex) & 0x1ffn) * 0x70n + 0x08n);

    let Name = Cache_Names.get(EntityClassInfoPtr);

    if (Name === undefined) {
      const SchemaClassInfoDataPtr = cs2.u64(EntityClassInfoPtr + 0x30n);
      /* */ const NamePtr = cs2.u64(SchemaClassInfoDataPtr + 0x08n);
      /*       */ Name = cs2.string(NamePtr, 0x80);

      Cache_Names.set(EntityClassInfoPtr, Name);
    }

    // Check that what we're aiming at it a C_CSPlayerPawn…
    if (Name !== 'C_CSPlayerPawn') {
      return;
    }

    const PlayerPawnPtr = BaseEntityPtr;
    /* */ const TeamNum = cs2.u8(PlayerPawnPtr + Client.C_BaseEntity.m_iTeamNum);

    if (TeamNum === Local_TeamNum) {
      return;
    }

    await sleep(random() * Delay + Delay);

    // Pull the trigger…
    mouse_event(0x02, 0x00, 0x00, 0x00, 0n);

    // If the gun is automatic, hold the trigger until we're no longer aiming at them…
    do {
      await sleep(random() * Delay + Delay);
    } while (Local_IDEntIndex === cs2.u32(Local_PlayerPawnPtr + Client.C_CSPlayerPawn.m_iIDEntIndex) && Local_IsFullAuto);

    // Release the trigger…
    mouse_event(0x04, 0x00, 0x00, 0x00, 0n);
  } catch (error) {
    // console.error(error);
    return;
  } finally {
    setImmediate(tick, ClientPtr);
  }
}

// Start the tick loop…
setImmediate(tick, ClientPtr);

// Log ticks per second…
setInterval(() => {
  console.clear();
  console.log('[TB] Ticks per second: %d', ticks);
  ticks = 0;
}, 1_000);
