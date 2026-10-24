# plan 字段演示示例

> 只演示 plan 字段怎么写，**不是结构清单，也不是推荐版式**。
> 结构应从内容关系推导；这里只给两个最小样例。
> `asset` 一律 `@placeholder`，素材阶段再 patch；示例统一 `fit:'cover'`。

## 示例 A：文字为主（0 图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'text', name:'kicker', rect:{x:.08,y:.12,w:.50}, fontScale:.016, placeholder:'独立出版 · 第 3 期' }
      - { type:'text', name:'title',  rect:{x:.08,y:.20,w:.84}, fontScale:.15,  placeholder:'夜行' }
      - { type:'shape', kind:'rect',  name:'rule', rect:{x:.08,y:.58,w:.30,h:.004} }
  - name: 文字信息
    elements:
      - { type:'text', name:'subtitle', rect:{x:.08,y:.63,w:.60}, fontScale:.028, placeholder:'一场关于城市与失眠的展览' }
      - { type:'text', name:'dates',    rect:{x:.08,y:.73,w:.50}, fontScale:.020, placeholder:'9.12 — 10.20' }
      - { type:'text', name:'note',     rect:{x:.08,y:.90,w:.84}, fontScale:.014, placeholder:'周二至周日 11:00–19:00' }
```

## 示例 B：图文并置（1 图）

```yaml
canvas: { ratio: '4:5', background: '#F7F3EA' }
layers:
  - name: 主视觉
    elements:
      - { type:'image', name:'image-main', rect:{x:.50,y:0,w:.50,h:1}, asset:'@placeholder', fit:'cover' }
  - name: 文字信息
    elements:
      - { type:'text', name:'kicker', rect:{x:.07,y:.12,w:.36}, fontScale:.016, placeholder:'NIGHT WALK' }
      - { type:'text', name:'title',  rect:{x:.07,y:.20,w:.38}, fontScale:.07,  placeholder:'夜行' }
      - { type:'text', name:'body',   rect:{x:.07,y:.52,w:.36}, fontScale:.022, placeholder:'一场关于城市与失眠的展览' }
      - { type:'text', name:'labels', rect:{x:.07,y:.68,w:.36}, fontScale:.017, placeholder:'9.12 — 10.20' }
      - { type:'text', name:'note',   rect:{x:.07,y:.90,w:.36}, fontScale:.014, placeholder:'周二至周日 11:00–19:00' }
```
