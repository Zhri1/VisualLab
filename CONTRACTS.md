# 棣栫増鎺ュ彛濂戠害

棣栫増妯℃澘涓?`incline_spring`銆備富婕旂ず棰樸€佺墿鐞嗗墠鎻愬拰楠屾敹鏁板€艰 [鍙傝禌鏈€缁堟柟妗圿(PROJECT_PLAN_FINAL.md)銆?
## 1. 璇嗗埆鏁版嵁 `Reading`

AI 杩斿洖缁撴瀯鍖?`reading`銆傛牱渚嬫槸 [incline-spring.reading.json](fixtures/incline-spring.reading.json)锛屽墠绔€佸姩鐢诲簱鍜岃瘑鍒湇鍔″叡鐢ㄨ繖涓€浠姐€?
| 鏉′欢瀛楁 | 鍗曚綅鍜岃姹?|
|---|---|
| `gravityMps2` | m/s虏锛屾湁闄愭鏁?|
| `inclineAngleDeg` | 搴︼紝澶т簬 0掳 涓斿皬浜?90掳 |
| `inclineLengthM` | m锛屾湁闄愭鏁?|
| `kineticFrictionCoefficient` | 鏃犻噺绾诧紝鏈夐檺闈炶礋鏁?|
| `initialSpeedMps` | m/s锛岄鐗堜负 0 |
| `blockMassKg` | kg锛屾湁闄愭鏁?|
| `springGapM` | m锛屽潯搴曞埌寮圭哀鍘熼暱鎺ヨЕ绔殑姘村钩璺濈锛屼负鏈夐檺姝ｆ暟 |
| `springConstantNpm` | N/m锛屾湁闄愭鏁?|

`facts` 璁板綍銆岄噴鏀惧悗涓嬫粦銆嶃€屾棤鎹熻浆鍚戙€嶃€屾按骞抽潰鍏夋粦銆嶃€屾粦鍧椾笌寮圭哀涓嶈繛鎺ャ€嶏紝瀛楁鍚嶄緷娆′负 `slidesAfterRelease`銆乣losslessTurn`銆乣horizontalIsFrictionless` 鍜?`springIsUnattached`銆備簨瀹炵敤 `true`銆乣false` 鎴?`null` 琛ㄧず銆傛棤娉曠‘璁ょ殑鏁板€间篃鐢?`null`锛屼繚鐣欑粰鐢ㄦ埛琛ラ綈銆傞闈㈡槑纭繚鑳屾ā鏉垮墠鎻愭椂杩斿洖瓒呰寖鍥淬€?
## 2. 涓婁紶鎺ュ彛

娴忚鍣ㄧ敤 `POST /api/animation/plan` 鍙戦€?`multipart/form-data`锛屽浘鐗囧瓧娈典负 `image`锛屾敮鎸佸崟寮?JPG 鎴?PNG銆傚彲閫夊瓧娈?`text` 涓烘枃瀛楁ā寮忎笅瀛︾敓琛ュ厖鐨勯鐩弿杩帮紙鈮?2000 瀛楋級锛屾彁渚涙椂涓庡浘鐗囦竴璧烽€佺粰妯″瀷锛屼笌鍥句腑鏍囨敞鍐茬獊鏃朵互鏂囧瓧涓哄噯銆?
| HTTP | 鍝嶅簲浣?| 椤甸潰澶勭悊 |
|---|---|---|
| 200 | `{ "status": "ok", "reading": { ... }, "message": "宸叉寜 g=10 m/s虏銆佄?0.5 璁＄畻", "assumptions": ["g=10 m/s虏", "渭=0.5"] }` | 灞曠ず鍘熷浘涓庤瘑鍒€硷紝璁＄畻骞舵挱鏀俱€?|
| 200 | `{ "status": "needs_input", "reading": { ... }, "missingKeys": ["springGapM"], "message": "璇风‘璁ゆ按骞抽棿璺? }` | 淇濈暀宸茶В鏋愬瓧娈碉紝鎻愮ず琛ュ€笺€傛棤娉曡瘑鍒鍨嬫椂 `reading` 鍙负 `null`锛屾彁绀洪噸鎷嶃€?|
| 200 | `{ "status": "unsupported", "message": "褰撳墠鐗堟湰鏀寔鏂滈潰鎺ュ厜婊戞按骞抽潰涓庡脊绨х殑杩愬姩" }` | 鎻愮ず鏀寔鑼冨洿锛屾彁渚涘唴缃ず渚嬪叆鍙ｃ€?|
| 400銆?02 鎴?504 | `{ "message": "..." }` | 鍒嗗埆瀵瑰簲鏃犳晥鍥剧墖銆佽瘑鍒湇鍔″け璐ャ€佽秴鏃躲€備繚鐣欏浘鐗囧苟鍏佽閲嶈瘯銆?|

涓夌 200 鍥炲寘閮藉甫 `message`锛岄〉闈㈡妸瀹冩樉绀哄湪瀵硅瘽鍖猴細`ok` 鏃舵槸鏈璁＄畻鐨勫亣璁炬憳瑕侊紙鐢?`assumptions` 鎷兼垚锛屾病鏈夊亣璁炬椂缁欎竴鍙モ€滃凡鎸夐闈㈡潯浠惰瘑鍒畬鎴愨€濓級锛宍needs_input` 涓?`unsupported` 鏃舵槸缁欑敤鎴风殑鎻愮ず銆俙assumptions` 鍘熸牱閫忎紶妯″瀷鐨勮鏄庢潯鐩紝鏈€澶?3 鏉★紝鍙渷鐣ャ€?
`missingKeys` 浣跨敤 `reading` 涓殑鍘熷瓧娈靛悕锛屼緥濡?`springGapM`銆傚悗绔礋璐ｆ牎楠屾ā鍨嬪洖鍖咃紝娴忚鍣ㄨ礋璐ｆ牴鎹湰鍦扮紪杈戝悗鐨勬暟鎹噸鏂扮敓鎴愬満鏅€?
## 3. 鍦烘櫙瑁呴厤涓庢挱鏀?
`assembleScene(reading)` 妫€鏌ュ繀濉瓧娈点€佸崟浣嶈寖鍥村拰妯℃澘鍓嶆彁銆傛垚鍔熸椂杩斿洖鍦烘櫙锛屽け璐ユ椂缁欏嚭瀛楁鍙婅鏄庛€傚潗鏍囧師鐐逛负鏂滈潰搴曠锛屾按骞冲悜鍙炽€佺珫鐩村悜涓娿€傚€捐銆佹枩闀挎垨寮圭哀闂磋窛鍙戠敓淇敼鏃讹紝閲嶆柊瑁呴厤鍥惧舰鍜岄樁娈点€傞潤姝㈤噴鏀句笖涓嬪潯鍔犻€熷害灏忎簬鎴栫瓑浜庨浂鏃讹紝鎻愮ず鐢ㄦ埛鏍稿鐭涚浘鐨勬潯浠躲€?
`buildMotion(scene)` 鎴愬姛鏃惰繑鍥炰互涓嬫湰鍦板璞★紝澶辫触鏃惰繑鍥炲彲灞曠ず鐨?`code` 鍜?`message`銆?
| 瀛楁鎴栨柟娉?| 鍐呭 |
|---|---|
| `geometry` | 绫冲埗鏂滈潰绔偣銆佹按骞抽潰銆佸脊绨у師闀挎帴瑙︾鍜屽浐瀹氱銆傛湭缁欏脊绨у師闀挎椂鎸夌ず鎰忕敾锛屽帇缂╀綅绉绘寜璁＄畻鍊笺€?|
| `durationSeconds`銆乣segments` | 鎬荤墿鐞嗘椂闀匡紝浠ュ強鏂滈潰婊戝姩銆佹按骞冲寑閫熴€佸脊绨ф帴瑙︿笁娈电殑璧锋鏃堕棿銆?|
| `events` | 浠庨噴鏀惧紑濮嬭鐨勪簨浠舵椂闂淬€佸悕绉板拰瀛楀箷銆傝浆鍚戜簨浠跺彲甯﹀墠鍚庨€熷害鍚戦噺銆?|
| `sampleAt(timeSeconds)` | 鍚屼竴鍧愭爣绯讳笅婊戝潡鐨勪綅缃€侀€熷害鍜屽脊绨у帇缂╅噺銆傚湪浜嬩欢鏃堕棿鍙栨牱鏃堕噰鐢ㄤ簨浠跺悗鐨勭姸鎬併€?|

鐢ㄦ埛鐐瑰嚮銆屽簲鐢ㄦ潯浠躲€嶅悗鍦ㄦ祻瑙堝櫒渚濇璋冪敤 `assembleScene` 鍜?`buildMotion`銆傛殏鍋溿€侀噸鎾拰璺宠浆鍙敼鍙樻挱鏀惧櫒鏃堕棿銆傜敾闈€佸瓧骞曞拰涓嬩竴鍏抽敭鐐瑰叡鐢?`events` 涓庡悓涓€鏃堕棿杞淬€?
鎶婃牱渚嬩腑鐨?`springGapM` 浠?1 鏀逛负 2锛屽脊绨ф帴瑙︿綅缃簲鍙崇Щ 1 m锛岄娆℃帴瑙︽椂鍒讳粠绾?2.2361 s 鍙樹负 2.4845 s銆?
## 4. 鎾斁鍣ㄩ€傞厤鍏ュ彛

鎾斁鍣ㄤ粠 `src/adapters/index.ts` 鍙栧緱 `motionLibrary`锛屽叡浜被鍨嬫部鐢?`src/types/index.ts`銆傞€傞厤灞傚鐢?`src/physics` 鐨勬牎楠屽拰璁＄畻锛岀函璁＄畻鍏叡瀵煎嚭淇濇寔鍙緵鏈嶅姟绔娇鐢ㄣ€?
| 绾绠楃粨鏋?| 鎾斁鍣ㄧ粨鏋?|
|---|---|
| 娈?`id` | `kind`锛屼繚鐣?incline銆乭orizontal銆乻pring |
| turn銆乻pring_contact銆乻pring_detach | reach_bottom銆乧ontact_spring銆乨etach_spring |
| beforeVelocity銆乤fterVelocity | velocityBefore銆乿elocityAfter锛屽垎閲忔槧灏勪负 x銆亂 |
| explanation | caption 鍜?detail锛屾暟鍊奸殢姹傝В缁撴灉鏇存柊 |
| xM銆亂M銆乿xMps銆乿yMps | position 鍜?velocity 鐨?x銆亂 |
| NEEDS_INPUT | MISSING |
| INCONSISTENT_CONDITIONS | PRECONDITION_CONFLICT |
| UNSUPPORTED | 棰樺瀷瀛楁鏄犲皠涓?UNSUPPORTED_TEMPLATE锛屽叾浠栧墠鎻愭槧灏勪负 PRECONDITION_CONFLICT |
| INVALID_READING | 闈炴湁闄愭暟瀛楁槧灏勪负 NOT_FINITE锛屽叾浠栨牸寮忔垨鑼冨洿閿欒鏄犲皠涓?RANGE |

閿欒淇濈暀鍘熷瓧娈靛悕銆傝浆鍚戜簨浠跺綊姘村钩娈碉紝鎺ヨЕ浜嬩欢褰掑脊绨ф銆傛按骞充笌寮圭哀鍙栨牱鐨?position.y 鍧囦负 0锛岀敾甯冭嚜琛岃绠楁粦鍧椾腑蹇冦€傚脊绨ф帴瑙︿簨浠剁殑 position.x 绛変簬 springContactX锛屽浐瀹氱浣跨敤鐗╃悊搴撻鐣欐渶澶у帇缂╃┖闂寸殑绀烘剰浣嶇疆锛宐lockSizeM 涓?0.3銆偽?鍙敤浜庢枩闈€?
閫傞厤鍦烘櫙涓烘湰鍦板璞★紝瑁呴厤鏃朵繚瀛樹竴娆℃眰瑙ｇ粨鏋滀互纭畾缁樺埗鍑犱綍锛宐uildMotion 鏄犲皠鎾斁鍣ㄥ瓧娈点€傜敤鎴锋敼鍊煎悗閲嶆柊瑁呴厤鍦烘櫙銆傝秴鍑哄尯闂寸殑鏃堕棿鍙栨渶杩戠鐐癸紝鎾斁鍣ㄩ€傞厤灞傚皢 NaN 鏃堕棿鎸夐噴鏀炬椂鍒诲鐞嗐€?
楠屾敹鎵ц `npm run test`锛堝惈鐪熷疄鍏紑鍏ュ彛鐨?19 椤圭敤渚嬶級銆乣node --test "src/physics/*.test.ts"`锛?4 椤癸級鍜?`npm run build`銆傛瀯寤洪厤缃惎鐢?TypeScript 鎵╁睍鍚嶅鍏ワ紝寮€鍙戜緷璧栬ˉ榻?Node 娴嬭瘯绫诲瀷銆俈itest 鎺掗櫎鐗╃悊灞傚師鐢?Node 娴嬭瘯鏂囦欢锛岀户缁娇鐢ㄩ粯璁よ鍒欏彂鐜板叾浣欐祴璇曘€?
