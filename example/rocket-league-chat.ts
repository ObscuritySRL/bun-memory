import { FFIType } from 'bun:ffi';

import { Buffer } from 'node:buffer';

import { GNames, GObjects } from '@rlsdk/epic-games/offsets';
import { FNameEntry, Object_, TArray } from '@rlsdk/epic-games/offsets/Core';
import { HUDBase_TA } from '@rlsdk/epic-games/offsets/TAGame';
import Process from 'bun-memory';

type PointerArrayHeader = {
  readonly count: number;
  readonly dataAddress: bigint;
};

const MessageText = 'Hello via Bun!';
const ProcessEventIndex = 0x43;
const RocketLeagueExecutable = 'RocketLeague.exe';
const SendGlobalChatMessageFunctionFullName = 'Function TAGame.GFxData_Chat_TA.SendGlobalChatMessage';
const SendGlobalChatMessageFunctionName = 'SendGlobalChatMessage';
const SendGlobalChatMessageSignature = { args: [FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.void } as const;

function readPointerArrayHeader(memory: Process, address: bigint, label: string): PointerArrayHeader {
  const count = memory.i32(address + TArray.Count);
  const dataAddress = memory.u64(address + TArray.Data);
  const maximum = memory.i32(address + TArray.Max);

  if (dataAddress === 0n || count <= 0 || maximum < count || count > 1_000_000) {
    throw new Error(`${label} is not a valid pointer array.`);
  }

  return { count, dataAddress };
}

const rocketLeague = new Process(RocketLeagueExecutable);

try {
  const rocketLeagueModule = rocketLeague.modules[RocketLeagueExecutable];

  if (rocketLeagueModule === undefined) {
    throw new Error(`${RocketLeagueExecutable} module was not found.`);
  }

  const globalNames = readPointerArrayHeader(rocketLeague, rocketLeagueModule.modBaseAddr + GNames, 'GNames');
  const globalObjects = readPointerArrayHeader(rocketLeague, rocketLeagueModule.modBaseAddr + GObjects, 'GObjects');
  const nameCache = new Map<number, string>();

  function readName(nameIndex: number): string {
    const cachedName = nameCache.get(nameIndex);

    if (cachedName !== undefined) {
      return cachedName;
    }

    if (nameIndex < 0 || nameIndex >= globalNames.count) {
      throw new RangeError(`FName index ${nameIndex} is outside GNames.`);
    }

    const nameEntryAddress = rocketLeague.u64(globalNames.dataAddress + BigInt(nameIndex) * 0x08n);

    if (nameEntryAddress === 0n) {
      throw new Error(`FName entry ${nameIndex} is null.`);
    }

    const name = rocketLeague.wideString(nameEntryAddress + FNameEntry.Name, 0x400);

    nameCache.set(nameIndex, name);

    return name;
  }

  function readObjectName(objectAddress: bigint): string {
    return readName(rocketLeague.i32(objectAddress + Object_.Name));
  }

  function readObjectClassName(objectAddress: bigint): string {
    const classAddress = rocketLeague.u64(objectAddress + Object_.Class);

    return classAddress !== 0n ? readObjectName(classAddress) : '';
  }

  function readObjectFullName(objectAddress: bigint): string {
    let fullName = readObjectName(objectAddress);
    let outerAddress = rocketLeague.u64(objectAddress + Object_.Outer);

    for (let depth = 0; outerAddress !== 0n; depth++) {
      if (depth > 0x40) {
        throw new Error('Object outer chain is too deep.');
      }

      fullName = `${readObjectName(outerAddress)}.${fullName}`;
      outerAddress = rocketLeague.u64(outerAddress + Object_.Outer);
    }

    return `${readObjectClassName(objectAddress)} ${fullName}`;
  }

  let chatDataAddress = 0n;
  let skippedObjects = 0;
  let sendGlobalChatMessageFunctionAddress = 0n;

  for (let index = 0; index < globalObjects.count; index++) {
    const objectAddress = rocketLeague.u64(globalObjects.dataAddress + BigInt(index) * 0x08n);

    if (objectAddress === 0n) {
      continue;
    }

    try {
      const objectName = readObjectName(objectAddress);

      if (sendGlobalChatMessageFunctionAddress === 0n && objectName === SendGlobalChatMessageFunctionName && readObjectFullName(objectAddress) === SendGlobalChatMessageFunctionFullName) {
        sendGlobalChatMessageFunctionAddress = objectAddress;
      }

      if (chatDataAddress === 0n) {
        const className = readObjectClassName(objectAddress);

        if (className === 'GFxData_Chat_TA' && !objectName.startsWith('Default__')) {
          chatDataAddress = objectAddress;
        } else if (className === 'GFxHUD_TA' || className === 'HUDBase_TA') {
          const candidateChatDataAddress = rocketLeague.u64(objectAddress + HUDBase_TA.ChatData);

          if (candidateChatDataAddress !== 0n && readObjectClassName(candidateChatDataAddress) === 'GFxData_Chat_TA' && !readObjectName(candidateChatDataAddress).startsWith('Default__')) {
            chatDataAddress = candidateChatDataAddress;
          }
        }
      }
    } catch {
      skippedObjects++;
    }

    if (chatDataAddress !== 0n && sendGlobalChatMessageFunctionAddress !== 0n) {
      break;
    }
  }

  if (sendGlobalChatMessageFunctionAddress === 0n) {
    throw new Error(`Could not find ${SendGlobalChatMessageFunctionFullName}. Skipped ${skippedObjects} transient objects.`);
  }

  if (chatDataAddress === 0n) {
    throw new Error(`Could not find a live GFxData_Chat_TA object. Skipped ${skippedObjects} transient objects.`);
  }

  const messageBuffer = Buffer.from(`${MessageText}\0`, 'utf16le');
  const processEventAddress = rocketLeague.vFunction(chatDataAddress, ProcessEventIndex);
  let remoteMessageAddress = 0n;
  let remoteParametersAddress = 0n;

  try {
    remoteMessageAddress = rocketLeague.alloc(messageBuffer.length);
    rocketLeague.write(remoteMessageAddress, messageBuffer);

    const characterCount = MessageText.length + 0x01;
    const parametersBuffer = Buffer.alloc(0x18);

    parametersBuffer.writeBigUInt64LE(remoteMessageAddress, 0x00);
    parametersBuffer.writeInt32LE(characterCount, 0x08);
    parametersBuffer.writeInt32LE(characterCount, 0x0c);
    parametersBuffer.writeUInt32LE(0x00, 0x10);

    remoteParametersAddress = rocketLeague.alloc(parametersBuffer.length);
    rocketLeague.write(remoteParametersAddress, parametersBuffer);

    rocketLeague.call(processEventAddress, SendGlobalChatMessageSignature, chatDataAddress, sendGlobalChatMessageFunctionAddress, remoteParametersAddress);
  } finally {
    if (remoteParametersAddress !== 0n) {
      rocketLeague.free(remoteParametersAddress);
    }

    if (remoteMessageAddress !== 0n) {
      rocketLeague.free(remoteMessageAddress);
    }
  }

  console.log(`Sent "${MessageText}" with ${SendGlobalChatMessageFunctionFullName}.`);
} finally {
  rocketLeague.close();
}
