# Code Studio 鈥?DSH Web GUI 鐨?VS Code + Cline 娣峰悎鎻掍欢

鍦?DeepSeek Harness 鐨?Web 鐣岄潰锛坵ebui锛夐噷鐩存帴**娴忚銆佺紪杈戜唬鐮?*锛屽苟鍦?**Agent 淇敼鏂囦欢鏃跺儚 Cline 涓€鏍烽€愯鏄剧ず Diff**锛氭敼鍔ㄥ尯琛屽彿鍓嶆爣娉?`+`锛堟柊澧?缁胯壊锛夈€乣-`锛堝垹闄?绾㈣壊锛夈€乣~`锛堜慨鏀?榛勮壊锛夈€?
## 鍔熻兘

- 鏂囦欢鏍戯細宸︿晶鎳掑姞杞界洰褰曟爲锛岀偣鍑绘枃浠舵墦寮€锛堟敮鎸佹墦寮€宸ヤ綔鍖轰换鎰忚矾寰勶級銆?- 缂栬緫鍣細甯﹁鍙风殑浠ｇ爜缂栬緫瑙嗗浘锛汣trl+S 淇濆瓨锛孋trl+D 鍦?缂栬緫/Diff 闂村垏鎹€?- Cline 寮?Diff锛欴iff 瑙嗗浘鎸夎鏄剧ず before/after锛涜鍙峰墠鏂规湁绗﹀彿鍒楋紙+ - ~锛夛紝鏈敼鍔ㄥぇ娈佃嚜鍔ㄦ姌鍙犱负銆屸嫰 N 琛屾湭鏀瑰姩銆嶏紝鍙偣鍑诲睍寮€鍏ㄩ儴銆?- Agent 鍙樻洿璺熻釜锛欻ost 渚ч€掑綊鐩戝惉宸ヤ綔鍖猴紙fs.watch + mtime 杞鍏滃簳锛夛紝Agent 鍐欏叆鏂囦欢鍚庢祻瑙堝櫒瀹炴椂鏀跺埌浜嬩欢锛涙枃浠舵爲椤堕儴銆孉gent 鍙樻洿銆嶅垪琛ㄦ樉绀烘湁鍙樻洿鐨勬枃浠讹紙缁?鏂板缓銆侀粍=淇敼銆佺孩=鍒犻櫎锛夛紝鐐瑰嚮鍗崇湅 Diff銆?- 鍙樻洿鍘嗗彶锛氭瘡涓枃浠朵繚鐣欐渶杩?30 鏉?before/after 璁板綍锛?api/code-studio/history锛夈€?- 鍙岀鎻掍欢锛欻ost锛圢ode锛夋彁渚?/api/code-studio/* REST + SSE锛汣lient锛堟祻瑙堝櫒 bundle锛夋彁渚?UI銆?
## 瀹夎锛堝凡瑁呭ソ锛?
鎻掍欢宸插畨瑁呭埌 web profile锛?DSH_HOME/profiles/web锛夛細
- 鍖呬綅浜?profiles/web/node_modules/@windypro-rourou/dsh-code-studio
- cordis.patch.yml 宸叉彃鍏?code-studio 琛?- package.json 宸插姞鍏?link:F:/CycleMaster/dsh-code-studio 渚濊禆

**鐢熸晥鏃舵満**锛欴SH 鐨勫鎴风鎻掍欢鍚嶅崟锛坆oot manifest锛夊湪鍚姩鏃跺浐鍖栵紝鏂版彃浠堕渶瑕?*閲嶅惎 dsh web**锛堟垨涓嬫鍚姩 harness锛夊悗鍑虹幇鍦ㄤ晶杈规爮銆傚綋鍓嶆鍦ㄨ繍琛岀殑 webui 鏃犳硶鐑姞杞芥柊鎻掍欢锛堣繖鏄钩鍙版満鍒讹紝闈炴彃浠剁己闄凤級銆?
### 鎵嬪姩瀹夎锛堝叾浠栨満鍣級

```powershell
# 1. 鐢ㄥ畼鏂瑰懡浠ら摼鎺ユ彃浠讹紙浼氳嚜鍔ㄦ妸瀹冨姞鍏?profile bundles 灞傦級
dsh plugin --profile web add link:F:/CycleMaster/dsh-code-studio

# 2. 鎴栬€呭湪 profiles/web/cordis.patch.yml 杩藉姞锛?# - insert:
#     - id: code-studio
#       name: '@windypro-rourou/dsh-code-studio'
```

### 鐜板湪灏辨兂棰勮锛?
```powershell
dsh web --port 3081   # 浼氱湅鍒颁晶杈规爮鍑虹幇 "Code Studio" 鍏ュ彛
```

## 浣跨敤

1. 鍒锋柊椤甸潰鍚庯紝宸︿晶杈规爮鍑虹幇 **Code Studio** 鍏ュ彛锛堜唬鐮佸浘鏍囷級銆?2. 鐐瑰嚮鎵撳紑鍏ㄥ睆闈㈡澘锛氬乏渚ф枃浠舵爲锛屼腑闂存爣绛鹃〉缂栬緫鍣ㄣ€?3. 璁?Agent 淇敼浠ｇ爜锛堝啓鏂囦欢/缂栬緫锛夛紝闈㈡澘椤堕儴銆孉gent 鍙樻洿銆嶅疄鏃跺垪鍑哄彉鍖栨枃浠躲€?4. 鐐瑰嚮鍙樻洿鏂囦欢 鈫?榛樿杩涘叆 Diff 瑙嗗浘锛氳鍙峰墠绗﹀彿 + 棰滆壊鑳屾櫙锛屼竴鐩簡鐒躲€?
## 蹇嵎閿?
| 鎸夐敭 | 鍔熻兘 |
| --- | --- |
| Ctrl+S | 淇濆瓨褰撳墠鏂囦欢 |
| Ctrl+D | 鍒囨崲 缂栬緫 / Diff 瑙嗗浘 |

## 鎶€鏈鏄?
- Host锛歭ib/index.js 鈥?webServer.register 娉ㄥ唽 6 涓矾鐢憋紱fs.watch(recursive) + 1500ms mtime 杞锛涘姣忎釜鏂囦欢缁存姢鍩虹嚎蹇収锛屼粠鑰屼骇鍑虹簿纭殑 before/after銆?- Client锛歭ib/client.js 鈥?绾祻瑙堝櫒 bundle锛坵indow.__ModuleLoader__.load锛夛紝浠呬緷璧?react/react-dom锛涜嚜甯?LCS 琛岀骇 diff 寮曟搸涓庢牱寮忋€?- 璺緞瀹夊叏锛欰PI 浠呮帴鍙?loopback + 鍚屾簮鏍囪璇锋眰銆?
## 宸茬煡闄愬埗

- 鍗曟枃浠?> 512KB 涓嶈鍙栧唴瀹癸紙闃叉祻瑙堝櫒鍗℃锛夛紝浣嗕細鏍囪銆屾枃浠惰繃澶с€嶃€?- Diff 瑙嗗浘閽堝銆屾墦寮€鍚?涓婃璇诲彇鍚庛€嶇殑鍙樻洿鍋氬熀绾垮姣旓紝绗﹀悎 Cline 鐨勪細璇濊涔夈€?