const d = await import("./dist/data.js");
const s = await import("./dist/server.js").catch(() => null);
const r = d.regionalPolicies.find((x) => x.id === "haeundae_gu");
// 구조화 응답에 대형폐기물 주소가 officialSources 말고 실리는 자리가 있는가
console.log("applicationUrl:", r.bulkyWaste.applicationUrl);
console.log("feeUrl:", r.bulkyWaste.feeUrl);
console.log("현재 상위 3 출처:", r.sources.slice(0, 3).map((x) => x.title).join(" / "));
