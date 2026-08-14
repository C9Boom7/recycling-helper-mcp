/**
 * HWP 5.x 본문 텍스트 추출 (의존성 없음).
 *
 * 자치법규 별표 첨부가 전부 HWP 5.x라서 필요하다. HWP 5.x는 OLE 복합 문서
 * 컨테이너에 zlib raw deflate 스트림을 담은 형식이라, Node 내장 `zlib`과
 * `Buffer`만으로 읽을 수 있다. 마감 직전에 `pnpm install` 표면을 늘리지
 * 않으려고 OLE 디렉터리 리더를 직접 구현했다.
 *
 * 표 구조는 복원하지 않는다. 셀 문단을 나오는 순서대로 이어 붙인 평문만
 * 돌려주며, 좌우 2단 조판처럼 순차 읽기로 열이 섞이는 문서는 호출부에서
 * 형태별로 처리한다(Phase 6 R2).
 *
 * 참고: HWP 5.0 파일 형식 공개 문서(한글과컴퓨터), MS-CFB(OLE 복합 문서).
 */
import { inflateRawSync } from "node:zlib";

const OLE_MAGIC = Buffer.from("d0cf11e0a1b11ae1", "hex");
const FREE_SECT = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;

const TYPE_STREAM = 2;
const TYPE_ROOT = 5;
const NO_STREAM = 0xffffffff;

/** 체인을 따라갈 때 손상된 FAT에 걸려 무한 루프에 빠지지 않도록 둔 상한. */
const MAX_CHAIN = 1_000_000;

/**
 * OLE 복합 문서를 읽어 `경로 -> Buffer` 맵을 돌려준다.
 * 경로는 `BodyText/Section0`처럼 루트를 뺀 슬래시 구분 형태다.
 */
export function readCompoundFile(buf) {
  if (buf.length < 512 || !buf.subarray(0, 8).equals(OLE_MAGIC)) {
    throw new Error("OLE 복합 문서가 아니다 (매직 불일치)");
  }

  const sectorSize = 1 << buf.readUInt16LE(30);
  const miniSectorSize = 1 << buf.readUInt16LE(32);
  const fatSectorCount = buf.readUInt32LE(44);
  const firstDirSector = buf.readUInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const firstMiniFatSector = buf.readUInt32LE(60);
  const miniFatSectorCount = buf.readUInt32LE(64);
  const firstDifatSector = buf.readUInt32LE(68);

  const sectorOffset = (sector) => 512 + sector * sectorSize;
  const sectorSlice = (sector) => {
    const start = sectorOffset(sector);
    if (start + sectorSize > buf.length) throw new Error(`섹터 ${sector}가 파일 밖을 가리킨다`);
    return buf.subarray(start, start + sectorSize);
  };

  // DIFAT — 헤더에 109개, 넘치면 별도 섹터 체인으로 이어진다.
  const difat = [];
  for (let i = 0; i < 109; i += 1) {
    const sector = buf.readUInt32LE(76 + i * 4);
    if (sector === FREE_SECT || sector === END_OF_CHAIN) break;
    difat.push(sector);
  }
  const entriesPerDifat = sectorSize / 4 - 1;
  let difatSector = firstDifatSector;
  for (let guard = 0; difatSector !== END_OF_CHAIN && difatSector !== FREE_SECT; guard += 1) {
    if (guard > MAX_CHAIN) throw new Error("DIFAT 체인이 끝나지 않는다");
    const slice = sectorSlice(difatSector);
    for (let i = 0; i < entriesPerDifat; i += 1) {
      const sector = slice.readUInt32LE(i * 4);
      if (sector !== FREE_SECT && sector !== END_OF_CHAIN) difat.push(sector);
    }
    difatSector = slice.readUInt32LE(entriesPerDifat * 4);
  }

  const fat = [];
  for (const sector of difat.slice(0, fatSectorCount)) {
    const slice = sectorSlice(sector);
    for (let i = 0; i < sectorSize / 4; i += 1) fat.push(slice.readUInt32LE(i * 4));
  }

  const readChain = (start, size) => {
    const parts = [];
    let sector = start;
    for (let guard = 0; sector !== END_OF_CHAIN && sector !== FREE_SECT; guard += 1) {
      if (guard > MAX_CHAIN) throw new Error("FAT 체인이 끝나지 않는다");
      if (sector >= fat.length) throw new Error(`FAT 범위를 벗어난 섹터 ${sector}`);
      parts.push(sectorSlice(sector));
      sector = fat[sector];
    }
    const joined = Buffer.concat(parts);
    return size === undefined ? joined : joined.subarray(0, size);
  };

  const miniFat = [];
  if (miniFatSectorCount > 0) {
    const raw = readChain(firstMiniFatSector);
    for (let i = 0; i + 4 <= raw.length; i += 4) miniFat.push(raw.readUInt32LE(i));
  }

  // 디렉터리 엔트리는 128바이트 고정이고, 루트부터 트리로 이어진다.
  const dirBuf = readChain(firstDirSector);
  const entryCount = Math.floor(dirBuf.length / 128);
  const entryAt = (index) => {
    const off = index * 128;
    const nameLen = dirBuf.readUInt16LE(off + 64);
    const type = dirBuf.readUInt8(off + 66);
    return {
      name: nameLen >= 2 ? dirBuf.toString("utf16le", off, off + nameLen - 2) : "",
      type,
      left: dirBuf.readUInt32LE(off + 68),
      right: dirBuf.readUInt32LE(off + 72),
      child: dirBuf.readUInt32LE(off + 76),
      start: dirBuf.readUInt32LE(off + 116),
      size: Number(dirBuf.readBigUInt64LE(off + 120)),
    };
  };

  const root = entryAt(0);
  if (root.type !== TYPE_ROOT) throw new Error("루트 디렉터리 엔트리가 없다");
  const miniStream = root.size > 0 ? readChain(root.start, root.size) : Buffer.alloc(0);

  const readMini = (start, size) => {
    const parts = [];
    let sector = start;
    for (let guard = 0; sector !== END_OF_CHAIN && sector !== FREE_SECT; guard += 1) {
      if (guard > MAX_CHAIN) throw new Error("miniFAT 체인이 끝나지 않는다");
      const off = sector * miniSectorSize;
      parts.push(miniStream.subarray(off, off + miniSectorSize));
      if (sector >= miniFat.length) break;
      sector = miniFat[sector];
    }
    return Buffer.concat(parts).subarray(0, size);
  };

  const streams = new Map();
  const seen = new Set();
  const walk = (index, prefix) => {
    if (index === NO_STREAM || index >= entryCount || seen.has(index)) return;
    seen.add(index);
    const entry = entryAt(index);
    walk(entry.left, prefix);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === TYPE_STREAM) {
      const data = entry.size < miniCutoff ? readMini(entry.start, entry.size) : readChain(entry.start, entry.size);
      streams.set(path, data);
    } else {
      walk(entry.child, path);
    }
    walk(entry.right, prefix);
  };
  walk(root.child, "");

  return streams;
}

const HWP_SIGNATURE = "HWP Document File";
const HWPTAG_PARA_TEXT = 67; // HWPTAG_BEGIN(0x10) + 51

/**
 * 레코드 헤더는 4바이트다 — tagId 10bit, level 10bit, size 12bit.
 * size가 0xFFF면 뒤따르는 4바이트가 실제 크기다.
 */
function* readRecords(buf) {
  let pos = 0;
  while (pos + 4 <= buf.length) {
    const header = buf.readUInt32LE(pos);
    pos += 4;
    const tagId = header & 0x3ff;
    let size = (header >> 20) & 0xfff;
    if (size === 0xfff) {
      if (pos + 4 > buf.length) return;
      size = buf.readUInt32LE(pos);
      pos += 4;
    }
    if (pos + size > buf.length) return;
    yield { tagId, data: buf.subarray(pos, pos + size) };
    pos += size;
  }
}

// 제어 문자는 종류에 따라 차지하는 wchar 수가 다르다. 확장·인라인은 8칸을
// 먹으므로 그만큼 건너뛰지 않으면 뒤 문자가 통째로 밀려 깨진다.
const EXTENDED_CONTROLS = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
const INLINE_CONTROLS = new Set([4, 5, 6, 7, 8, 9, 19, 20]);

function decodeParaText(data) {
  let out = "";
  for (let i = 0; i + 2 <= data.length; i += 2) {
    const code = data.readUInt16LE(i);
    if (code >= 32) {
      // 짝 없는 서로게이트가 제어 레코드에 섞여 들어온다(R0에서 강북구가
      // 여기서 깨졌다). 다만 본문은 UTF-16LE라 CJK 확장 한자는 정상적인
      // 서로게이트 쌍으로 저장되므로, 짝이 맞으면 살리고 없을 때만 버린다.
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = i + 4 <= data.length ? data.readUInt16LE(i + 2) : -1;
        if (low >= 0xdc00 && low <= 0xdfff) {
          out += String.fromCharCode(code, low);
          i += 2; // 루프의 +2와 합쳐 쌍 전체를 넘긴다.
        }
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) continue; // 짝 없는 하위 서로게이트
      out += String.fromCharCode(code);
      continue;
    }
    if (EXTENDED_CONTROLS.has(code) || INLINE_CONTROLS.has(code)) {
      if (code === 9) out += "\t";
      else if (code === 11) out += "\n"; // 표·그림 등 개체 경계
      i += 14; // 자신 포함 8 wchar = 16바이트. 루프의 +2와 합쳐 16이 된다.
      continue;
    }
    if (code === 10 || code === 13) out += "\n";
  }
  return out;
}

/**
 * HWP 5.x 버퍼에서 본문 텍스트를 뽑는다.
 * 실패하면 던진다 — 조용히 빈 문자열을 돌려주면 "표 없음"으로 오판된다.
 */
export function extractHwpText(buf) {
  const streams = readCompoundFile(buf);

  const header = streams.get("FileHeader");
  if (!header || header.length < 40) throw new Error("FileHeader 스트림이 없다");
  const signature = header.toString("latin1", 0, HWP_SIGNATURE.length);
  if (signature !== HWP_SIGNATURE) throw new Error(`HWP 서명이 아니다: ${JSON.stringify(signature)}`);

  const properties = header.readUInt32LE(36);
  const compressed = (properties & 0x01) !== 0;
  const encrypted = (properties & 0x02) !== 0;
  const distributed = (properties & 0x04) !== 0;
  if (encrypted) throw new Error("암호 걸린 문서라 열 수 없다");

  // 배포용 문서는 본문이 ViewText에 있고 별도 복호화가 필요하다. 여기서
  // 조용히 빈 결과를 내면 커버리지 착시가 생기므로 명시적으로 던진다.
  const sectionPaths = [...streams.keys()]
    .filter((path) => /(^|\/)Section\d+$/.test(path))
    .filter((path) => (distributed ? path.startsWith("ViewText/") : path.startsWith("BodyText/")))
    .sort((a, b) => {
      const num = (p) => Number(p.match(/(\d+)$/)?.[1] ?? 0);
      return num(a) - num(b);
    });

  if (sectionPaths.length === 0) {
    if (distributed) throw new Error("배포용(ViewText) 문서라 본문을 읽을 수 없다");
    throw new Error("BodyText 섹션 스트림이 없다");
  }

  const chunks = [];
  for (const path of sectionPaths) {
    const raw = streams.get(path);
    let section;
    try {
      section = compressed ? inflateRawSync(raw) : raw;
    } catch (error) {
      throw new Error(`${path} 압축 해제 실패: ${error.message}`);
    }
    for (const record of readRecords(section)) {
      if (record.tagId === HWPTAG_PARA_TEXT) chunks.push(decodeParaText(record.data));
    }
  }

  return chunks.join("\n");
}
