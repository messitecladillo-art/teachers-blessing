import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from '../services/api';
import {
  FunctionPlotData,
  MindMapRecord,
  SandboxPresetConfig,
  Surface3DData,
} from '../types';
import { IconDimensionCube, IconFunctionCurve, IconLessonDoc, IconMindMap, IconSlideDeck } from './EduIcons';
import { MindMapDrawioWorkbench } from './MindMapDrawioWorkbench';

export type WorkbenchDimension = '2d' | '3d' | 'phase' | 'mindmap';

interface FunctionPlotCardProps {
  initialExpr?: string;
  initialPlotData?: FunctionPlotData | null;
  activePreset?: SandboxPresetConfig | null;
  activePresetNonce?: number;
  subject?: string;
  domainId?: string;
  branch?: string;
  externalMindmap?: MindMapRecord | null;
  onExpandMindmap?: () => void;
  onArtifactsChanged?: () => void;
}

type Sandbox2DId = 'sympy' | 'cubic_extrema' | 'cyclic_group' | 'logistic' | 'damped_wave' | 'michaelis' | 'bayes_ppv' | 'marginal_econ';
type Model3DId = 'saddle' | 'complex_surface' | 'wave_interf' | 'dihedral' | 'vsepr' | 'peaks' | 'custom_3d';
type PhaseModelId = 'lorenz' | 'lotka' | 'dipole';

function gcdInt(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return Math.max(1, x);
}

function eulerPhi(n: number): number {
  let count = 0;
  for (let k = 1; k < n; k++) {
    if (gcdInt(n, k) === 1) count++;
  }
  return Math.max(1, count);
}

interface Dynamic2DCurveResult {
  title: string;
  formulaLabel: string;
  paramALabel: string;
  paramAMin: number;
  paramAMax: number;
  paramAStep: number;
  paramBLabel: string;
  paramBMin: number;
  paramBMax: number;
  paramBStep: number;
  xDomain: [number, number];
  yDomain: [number, number];
  fPts: [number, number][];
  dfPts: [number, number][];
  highlights: { x: number; y: number; label: string }[];
  fLegend: string;
  dfLegend: string;
}

function project3D(
  x: number,
  y: number,
  z: number,
  yawRad: number,
  pitchRad: number,
  cx: number,
  cy: number,
  scale: number
): { sx: number; sy: number; depth: number } {
  const cyaw = Math.cos(yawRad);
  const syaw = Math.sin(yawRad);
  const cp = Math.cos(pitchRad);
  const sp = Math.sin(pitchRad);

  const rx = x * cyaw - y * syaw;
  const ry = x * syaw + y * cyaw;
  const ry2 = ry * cp - z * sp;
  const rz2 = ry * sp + z * cp;

  const persp = 1 / (1 + ry2 * 0.09);
  return {
    sx: cx + rx * scale * persp,
    sy: cy - rz2 * scale * persp,
    depth: ry2,
  };
}

function buildDynamic2DModel(
  id: Exclude<Sandbox2DId, 'sympy'>,
  pA: number,
  pB: number
): Dynamic2DCurveResult {
  const N = 120;
  const fPts: [number, number][] = [];
  const dfPts: [number, number][] = [];

  if (id === 'cyclic_group') {
    const n = Math.max(4, Math.min(16, Math.round(pA)));
    const gRaw = Math.max(1, Math.min(15, Math.round(pB)));
    const g = gRaw % n;
    const ord = n / gcdInt(n, g === 0 ? n : g);
    const phi = eulerPhi(n);
    return {
      title: `有限循环群 Z_${n} 步长生成轨迹（生成元总数 φ(${n}) = ${phi}）`,
      formulaLabel: `元素 [${g}] 的阶 ord(${g}) = ${n} / gcd(${n}, ${g === 0 ? n : g}) = ${ord}${ord === n ? '（可生成全群）' : '（真子群）'}`,
      paramALabel: `群阶 n = ${n}`,
      paramAMin: 4,
      paramAMax: 16,
      paramAStep: 1,
      paramBLabel: `步长 g = ${gRaw}`,
      paramBMin: 1,
      paramBMax: 15,
      paramBStep: 1,
      xDomain: [0, 1],
      yDomain: [0, 1],
      fPts: [[0, 0]],
      dfPts: [],
      highlights: [],
      fLegend: 'Z_n',
      dfLegend: '',
    };
  }

  if (id === 'cubic_extrema') {
    const xLo = -1.6;
    const xHi = 3.8;
    for (let i = 0; i < N; i++) {
      const x = xLo + (i / (N - 1)) * (xHi - xLo);
      const y = x ** 3 - pA * x ** 2 + pB;
      const dy = 3 * x ** 2 - 2 * pA * x;
      fPts.push([x, y]);
      dfPts.push([x, dy]);
    }
    const statX = (2 * pA) / 3;
    const statY = statX ** 3 - pA * statX ** 2 + pB;
    const hl =
      pA > 0.08
        ? [
            { x: 0, y: pB, label: `极大 (0, ${pB.toFixed(1)})` },
            { x: statX, y: statY, label: `极小 (${statX.toFixed(1)}, ${statY.toFixed(1)})` },
          ]
        : [{ x: 0, y: pB, label: `退化驻点 (0, ${pB.toFixed(1)}) 无极值` }];
    return {
      title: `三次函数驻点分合：f(x) = x³ - ${pA.toFixed(1)}x² + ${pB.toFixed(1)}`,
      formulaLabel: `调节 a → 0 观察两极值合并退化为 x³ 非极值驻点`,
      paramALabel: `二次系数 a = ${pA.toFixed(2)}`,
      paramAMin: 0,
      paramAMax: 4.5,
      paramAStep: 0.1,
      paramBLabel: `常数平移 b = ${pB.toFixed(1)}`,
      paramBMin: -2,
      paramBMax: 3,
      paramBStep: 0.2,
      xDomain: [xLo, xHi],
      yDomain: [-6, 12],
      fPts,
      dfPts,
      highlights: hl,
      fLegend: 'f(x) 原函数',
      dfLegend: "f'(x) 导数",
    };
  }

  if (id === 'logistic') {
    const r = pA;
    const K = pB;
    const xLo = 0;
    const xHi = 5.5;
    for (let i = 0; i < N; i++) {
      const t = xLo + (i / (N - 1)) * (xHi - xLo);
      const val = K / (1 + (K - 1) * Math.exp(-r * t));
      const dval = r * val * (1 - val / K);
      fPts.push([t, val]);
      dfPts.push([t, dval]);
    }
    const tInflect = Math.max(0.1, Math.log(Math.max(1.1, K - 1)) / Math.max(0.2, r));
    return {
      title: `生态/公卫 Logistic 增长：K = ${K.toFixed(1)}, r = ${r.toFixed(2)}`,
      formulaLabel: `最大增速拐点严格发生在半容量 N = K/2 = ${(K / 2).toFixed(2)} 处`,
      paramALabel: `增长率 r = ${r.toFixed(2)}`,
      paramAMin: 0.5,
      paramAMax: 2.6,
      paramAStep: 0.05,
      paramBLabel: `环境容纳 K = ${K.toFixed(1)}`,
      paramBMin: 4,
      paramBMax: 12,
      paramBStep: 0.5,
      xDomain: [xLo, xHi],
      yDomain: [0, Math.max(10, K + 1.5)],
      fPts,
      dfPts,
      highlights: [{ x: tInflect, y: K / 2, label: `增速峰值 N=K/2 (${(K / 2).toFixed(1)})` }],
      fLegend: 'N(t) 种群/累计',
      dfLegend: "N'(t) 单日新增",
    };
  }

  if (id === 'damped_wave') {
    const gamma = pA;
    const omega = pB;
    const xLo = 0;
    const xHi = 6.5;
    for (let i = 0; i < N; i++) {
      const t = xLo + (i / (N - 1)) * (xHi - xLo);
      const env = 4 * Math.exp(-gamma * t);
      const y = env * Math.cos(omega * t);
      fPts.push([t, y]);
      dfPts.push([t, env]);
    }
    return {
      title: `阻尼简谐振动与声学衰减：γ = ${gamma.toFixed(2)}, ω = ${omega.toFixed(1)}`,
      formulaLabel: `虚线包络 ±4e^(-γt) 制约机械振动耗能衰减`,
      paramALabel: `阻尼系数 γ = ${gamma.toFixed(2)}`,
      paramAMin: 0,
      paramAMax: 0.8,
      paramAStep: 0.02,
      paramBLabel: `角频率 ω = ${omega.toFixed(1)}`,
      paramBMin: 1.0,
      paramBMax: 6.0,
      paramBStep: 0.2,
      xDomain: [xLo, xHi],
      yDomain: [-4.5, 4.5],
      fPts,
      dfPts,
      highlights: [{ x: 0, y: 4, label: '初始振幅 A=4' }],
      fLegend: 'y(t) 振子位移',
      dfLegend: 'Ae^(-γt) 包络线',
    };
  }

  if (id === 'michaelis') {
    const vmax = pA;
    const km = pB;
    const xLo = 0;
    const xHi = 10;
    for (let i = 0; i < N; i++) {
      const s = xLo + (i / (N - 1)) * (xHi - xLo);
      const v = (vmax * s) / (km + s);
      const dv = (vmax * km) / (km + s) ** 2;
      fPts.push([s, v]);
      dfPts.push([s, dv]);
    }
    return {
      title: `生物化学酶促米氏方程：Vmax = ${vmax.toFixed(1)}, Km = ${km.toFixed(2)}`,
      formulaLabel: `[S] = Km 时反应速率恰好达极限上限一半 (Vmax/2 = ${(vmax / 2).toFixed(2)})`,
      paramALabel: `极限Vmax = ${vmax.toFixed(1)}`,
      paramAMin: 3,
      paramAMax: 10,
      paramAStep: 0.5,
      paramBLabel: `半饱常数 Km = ${km.toFixed(2)}`,
      paramBMin: 0.3,
      paramBMax: 4.0,
      paramBStep: 0.1,
      xDomain: [xLo, xHi],
      yDomain: [0, 11],
      fPts,
      dfPts,
      highlights: [{ x: km, y: vmax / 2, label: `半速门槛 (Km=${km.toFixed(1)}, v=${(vmax / 2).toFixed(1)})` }],
      fLegend: 'v([S]) 催化速率',
      dfLegend: "dv/d[S] 边际敏捷度",
    };
  }

  if (id === 'bayes_ppv') {
    const se = pA;
    const sp = pB;
    const xLo = 0;
    const xHi = 0.5;
    for (let i = 0; i < N; i++) {
      const p = xLo + (i / (N - 1)) * (xHi - xLo);
      const denom = se * p + (1 - sp) * (1 - p);
      const ppv = denom > 1e-9 ? (se * p) / denom : 0;
      fPts.push([p, ppv]);
      dfPts.push([p, p]); // baseline diagonal
    }
    const p1 = 0.01;
    const ppv1 = (se * p1) / (se * p1 + (1 - sp) * (1 - p1));
    return {
      title: `医学/AI 贝叶斯阳性预测：Se = ${(se * 100).toFixed(0)}%, Sp = ${(sp * 100).toFixed(0)}%`,
      formulaLabel: `当先验患病率 p=1% 时，阳性者真患病后验 PPV 仅 ${(ppv1 * 100).toFixed(1)}%！`,
      paramALabel: `灵敏度 Se = ${(se * 100).toFixed(0)}%`,
      paramAMin: 0.7,
      paramAMax: 0.99,
      paramAStep: 0.01,
      paramBLabel: `特异度 Sp = ${(sp * 100).toFixed(0)}%`,
      paramBMin: 0.8,
      paramBMax: 0.99,
      paramBStep: 0.01,
      xDomain: [xLo, xHi],
      yDomain: [0, 1.05],
      fPts,
      dfPts,
      highlights: [{ x: 0.01, y: ppv1, label: `p=1% → PPV=${(ppv1 * 100).toFixed(1)}%` }],
      fLegend: 'PPV(p) 真阳性置信度',
      dfLegend: 'y=p 无检测基准线',
    };
  }

  // marginal_econ
  const alpha = pA;
  const beta = pB;
  const xLo = 0;
  const xHi = 4.5;
  for (let i = 0; i < N; i++) {
    const x = xLo + (i / (N - 1)) * (xHi - xLo);
    const u = alpha * x * Math.exp(-beta * x);
    const du = alpha * (1 - beta * x) * Math.exp(-beta * x);
    fPts.push([x, u]);
    dfPts.push([x, du]);
  }
  const optX = 1 / Math.max(0.2, beta);
  const optU = alpha * optX * Math.exp(-beta * optX);
  return {
    title: `经管/工程边际最优配置：U(x) = ${alpha.toFixed(1)}x·e^(-${beta.toFixed(2)}x)`,
    formulaLabel: `边际收益 U'(x)=0 对应最优投入规模 x* = 1/β = ${optX.toFixed(2)}`,
    paramALabel: `收益系数 α = ${alpha.toFixed(1)}`,
    paramAMin: 2,
    paramAMax: 10,
    paramAStep: 0.5,
    paramBLabel: `摩擦衰减 β = ${beta.toFixed(2)}`,
    paramBMin: 0.35,
    paramBMax: 1.5,
    paramBStep: 0.05,
    xDomain: [xLo, xHi],
    yDomain: [-3, 9],
    fPts,
    dfPts,
    highlights: [{ x: optX, y: optU, label: `最优配置 (${optX.toFixed(2)}, ${optU.toFixed(2)})` }],
    fLegend: 'U(x) 净效用',
    dfLegend: "U'(x) 边际增量",
  };
}

export const FunctionPlotCard: React.FC<FunctionPlotCardProps> = ({
  initialExpr = 'x^3 - 3*x^2 + 2',
  initialPlotData = null,
  activePreset = null,
  activePresetNonce = 0,
  subject = '跨学科',
  domainId = '',
  branch = '',
  externalMindmap = null,
  onExpandMindmap,
  onArtifactsChanged,
}) => {
  const [dimension, setDimension] = useState<WorkbenchDimension>('2d');

  // === Dimension 1: 2D State ===
  const [sandbox2D, setSandbox2D] = useState<Sandbox2DId>('sympy');
  const [paramA, setParamA] = useState(3.0);
  const [paramB, setParamB] = useState(2.0);
  const [exprInput, setExprInput] = useState(initialExpr);
  const [plot, setPlot] = useState<FunctionPlotData | null>(initialPlotData);
  const [loading2D, setLoading2D] = useState(false);
  const [xCursor, setXCursor] = useState<number>(1.0);
  const [showDeriv, setShowDeriv] = useState(true);

  // === Dimension 2: 3D Surface / Geometry / VSEPR State ===
  const [model3D, setModel3D] = useState<Model3DId>('saddle');
  const [yaw, setYaw] = useState(0.65);
  const [pitch, setPitch] = useState(0.58);
  const [dihedralDeg, setDihedralDeg] = useState(118);
  const [vseprMolecule, setVseprMolecule] = useState<'CH4' | 'NH3' | 'H2O'>('H2O');
  const [showContour3D, setShowContour3D] = useState(true);
  const [expr3DInput, setExpr3DInput] = useState('x^2 - y^2');
  const [surfaceData, setSurfaceData] = useState<Surface3DData | null>(null);
  const [loading3D, setLoading3D] = useState(false);
  const canvas3DRef = useRef<HTMLCanvasElement | null>(null);
  const drag3DRef = useRef<{ down: boolean; lx: number; ly: number }>({ down: false, lx: 0, ly: 0 });

  // === Dimension 3: High-D Phase Space & Fields State ===
  const [phaseModel, setPhaseModel] = useState<PhaseModelId>('lorenz');
  const [phasePlaying, setPhasePlaying] = useState(true);
  const [lorenzRho, setLorenzRho] = useState(28);
  const [lotkaAlpha, setLotkaAlpha] = useState(1.2);
  const [phaseYaw, setPhaseYaw] = useState(0.6);
  const canvasPhaseRef = useRef<HTMLCanvasElement | null>(null);
  const dragPhaseRef = useRef<{ down: boolean; lx: number }>({ down: false, lx: 0 });
  const [insertingTarget, setInsertingTarget] = useState<'ppt' | 'lesson' | null>(null);
  const [insertToast, setInsertToast] = useState('');

  const handleInsertVisual = async (target: 'ppt' | 'lesson', dynamicTitle?: string, dynamicCaption?: string) => {
    setInsertingTarget(target);
    setInsertToast('');
    try {
      let activeExpr = exprInput || 'x^3 - 3*x^2 + 2';
      if (dimension === '2d' && sandbox2D !== 'sympy') {
        if (sandbox2D === 'cubic_extrema') activeExpr = `x^3 - ${paramA}*x^2 + ${paramB}`;
        else if (sandbox2D === 'logistic') activeExpr = `${paramB}/(1 + exp(-${paramA}*(x - 1.5)))`;
        else if (sandbox2D === 'damped_wave') activeExpr = `exp(-${paramA}*x)*cos(${paramB}*x)`;
        else if (sandbox2D === 'michaelis') activeExpr = `${paramA}*x/(${paramB} + x)`;
      }
      const res = await apiJson<{ ok: boolean; target_title: string }>('/api/agent/insert-visual', {
        method: 'POST',
        body: JSON.stringify({
          target,
          visual_title: dynamicTitle || `函数图像 (${activeExpr})`,
          expr: activeExpr,
          caption: dynamicCaption || '结合图像变化趋势观察临界点与单调区间',
        }),
      });
      setInsertToast(`已插入${target === 'lesson' ? '教案' : '课件'}《${res.target_title.slice(0, 14)}》`);
      onArtifactsChanged?.();
    } catch (e) {
      setInsertToast(e instanceof Error ? e.message : '插入失败');
    } finally {
      setInsertingTarget(null);
      window.setTimeout(() => setInsertToast(''), 4000);
    }
  };

  const loadPlot = async (expr: string) => {
    if (!expr.trim()) return;
    setLoading2D(true);
    try {
      const res = await apiJson<FunctionPlotData>('/api/tutor/plot-function', {
        method: 'POST',
        body: JSON.stringify({ expression: expr }),
      });
      setPlot(res);
      if (res.ok && res.curve_samples?.length) {
        const mid = res.curve_samples[Math.floor(res.curve_samples.length * 0.35)];
        setXCursor(mid?.x ?? 0);
      }
    } catch (err) {
      setPlot({
        ok: false,
        error: err instanceof Error ? err.message : '绘图失败',
        expression: expr,
        expr_latex: expr,
        deriv_latex: '',
        x_domain: [-2, 3.5],
        y_domain: [-4, 4],
        f_segments: [],
        df_segments: [],
        critical_points: [],
        curve_samples: [],
      });
    } finally {
      setLoading2D(false);
    }
  };

  const loadSurface3D = async (expr: string) => {
    if (!expr.trim()) return;
    setLoading3D(true);
    try {
      const res = await apiJson<Surface3DData>('/api/tutor/plot-surface-3d', {
        method: 'POST',
        body: JSON.stringify({ expression: expr, grid_size: 23 }),
      });
      setSurfaceData(res);
      setModel3D('custom_3d');
    } catch {
      /* ignore transient */
    } finally {
      setLoading3D(false);
    }
  };

  useEffect(() => {
    if (initialPlotData && initialPlotData.ok) {
      setPlot(initialPlotData);
      setExprInput(initialPlotData.expression);
      const mid = initialPlotData.curve_samples?.[Math.floor((initialPlotData.curve_samples?.length || 1) * 0.35)];
      if (mid) setXCursor(mid.x);
    } else if (!plot) {
      loadPlot(initialExpr);
    }
  }, [initialPlotData]);

  useEffect(() => {
    if (!initialPlotData && initialExpr && initialExpr !== exprInput) {
      setExprInput(initialExpr);
      setSandbox2D('sympy');
      loadPlot(initialExpr);
    }
  }, [initialExpr]);

  // Apply external preset pushed by matrix or discipline switcher
  useEffect(() => {
    if (!activePreset) return;
    if (activePreset.dimension === 'mindmap') {
      setDimension('mindmap');
      return;
    }
    if (activePreset.dimension === '3d' || activePreset.preset_id === 'saddle_3d' || activePreset.preset_id === 'complex_surface') {
      setDimension('3d');
      if (activePreset.preset_id === 'complex_surface') {
        setModel3D('complex_surface');
        return;
      }
      if (activePreset.expr) {
        setExpr3DInput(activePreset.expr);
        loadSurface3D(activePreset.expr);
      }
      return;
    }
    if (activePreset.preset_id === 'lorenz_3d') {
      setDimension('phase');
      setPhaseModel('lorenz');
      return;
    }
    setDimension('2d');
    const pid = activePreset.preset_id;
    if (pid === 'cubic_extrema' || pid === 'cyclic_group' || pid === 'logistic' || pid === 'damped_wave' || pid === 'michaelis' || pid === 'bayes_ppv' || pid === 'marginal_econ') {
      setSandbox2D(pid);
      const vals = Object.values(activePreset.params || {});
      if (typeof vals[0] === 'number') setParamA(vals[0]);
      if (typeof vals[1] === 'number') setParamB(vals[1]);
      setXCursor(pid === 'bayes_ppv' ? 0.05 : 1.2);
    } else if (activePreset.expr) {
      setSandbox2D('sympy');
      setExprInput(activePreset.expr);
      loadPlot(activePreset.expr);
    }
  }, [activePreset, activePresetNonce]);

  useEffect(() => {
    if (externalMindmap) setDimension('mindmap');
  }, [externalMindmap]);

  // 2D Dynamic Sandbox switcher helper
  const handleSelect2DSandbox = (id: Sandbox2DId) => {
    setSandbox2D(id);
    if (id === 'cubic_extrema') { setParamA(3.0); setParamB(2.0); setXCursor(1.0); }
    else if (id === 'cyclic_group') { setParamA(12); setParamB(5); }
    else if (id === 'logistic') { setParamA(1.5); setParamB(8.0); setXCursor(1.3); }
    else if (id === 'damped_wave') { setParamA(0.22); setParamB(3.2); setXCursor(1.4); }
    else if (id === 'michaelis') { setParamA(8.0); setParamB(1.5); setXCursor(2.0); }
    else if (id === 'bayes_ppv') { setParamA(0.95); setParamB(0.96); setXCursor(0.05); }
    else if (id === 'marginal_econ') { setParamA(6.0); setParamB(0.8); setXCursor(1.25); }
  };

  // === Compute current 2D SVG geometry ===
  const dynamic2D = useMemo(() => {
    if (sandbox2D === 'sympy') return null;
    return buildDynamic2DModel(sandbox2D, paramA, paramB);
  }, [sandbox2D, paramA, paramB]);

  const W = 640;
  const H = 264;
  const px0 = 54;
  const py0 = 26;
  const pw = W - 78;
  const ph = H - 56;

  const xLo = dynamic2D ? dynamic2D.xDomain[0] : (plot?.x_domain?.[0] ?? -1.5);
  const xHi = dynamic2D ? dynamic2D.xDomain[1] : (plot?.x_domain?.[1] ?? 3.5);
  const yLo = dynamic2D ? dynamic2D.yDomain[0] : (plot?.y_domain?.[0] ?? -4);
  const yHi = dynamic2D ? dynamic2D.yDomain[1] : (plot?.y_domain?.[1] ?? 4);

  const toX = (vx: number) => px0 + Math.max(0, Math.min(1, (vx - xLo) / Math.max(0.05, xHi - xLo))) * pw;
  const toY = (vy: number) => py0 + (1 - (vy - yLo) / Math.max(0.05, yHi - yLo)) * ph;

  const fmtTick = (v: number) => (Math.abs(v - Math.round(v)) < 0.08 ? String(Math.round(v)) : Number(v.toFixed(2)).toString());
  const buildCleanTicks = (lo: number, hi: number, count = 4): number[] => {
    const span = Math.max(0.1, hi - lo);
    const rawStep = span / Math.max(1, count - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const niceStep = norm <= 1.2 ? 1 * mag : norm <= 2.5 ? 2 * mag : norm <= 5.5 ? 5 * mag : 10 * mag;
    const ticks: number[] = [];
    const start = Math.ceil(lo / niceStep) * niceStep;
    for (let v = start; v <= hi + 1e-6; v += niceStep) ticks.push(Number(v.toFixed(3)));
    return ticks.length >= 2 ? ticks.slice(0, 6) : [lo, Number(((lo + hi) / 2).toFixed(2)), hi];
  };
  const yTicks = buildCleanTicks(yLo, yHi, 4);
  const xTicks = buildCleanTicks(xLo, xHi, 5);

  let activeSample: { x: number; y: number; dy: number } | null = null;
  if (dynamic2D && dynamic2D.fPts.length >= 2) {
    let bestIdx = 0;
    let bestD = Infinity;
    dynamic2D.fPts.forEach((pt, idx) => {
      const d = Math.abs(pt[0] - xCursor);
      if (d < bestD) { bestD = d; bestIdx = idx; }
    });
    const prev = dynamic2D.fPts[Math.max(0, bestIdx - 1)];
    const next = dynamic2D.fPts[Math.min(dynamic2D.fPts.length - 1, bestIdx + 1)];
    const slope = (next[1] - prev[1]) / Math.max(1e-5, next[0] - prev[0]);
    activeSample = { x: dynamic2D.fPts[bestIdx][0], y: dynamic2D.fPts[bestIdx][1], dy: slope };
  } else if (plot?.ok && plot.curve_samples?.length) {
    let best = plot.curve_samples[0];
    let minDist = Math.abs(best.x - xCursor);
    for (const s of plot.curve_samples) {
      const d = Math.abs(s.x - xCursor);
      if (d < minDist) { minDist = d; best = s; }
    }
    activeSample = best;
  }

  let tangentLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (activeSample) {
    const span = (xHi - xLo) * 0.22;
    const tx1 = activeSample.x - span;
    const ty1 = activeSample.y + activeSample.dy * (tx1 - activeSample.x);
    const tx2 = activeSample.x + span;
    const ty2 = activeSample.y + activeSample.dy * (tx2 - activeSample.x);
    tangentLine = { x1: toX(tx1), y1: toY(ty1), x2: toX(tx2), y2: toY(ty2) };
  }

  const slopeSign =
    activeSample === null
      ? ''
      : Math.abs(activeSample.dy) < 0.08
      ? '切线水平（临界驻点/峰值）'
      : activeSample.dy > 0
      ? '斜率 > 0 · 递增阶段'
      : '斜率 < 0 · 递减阶段';

  // === Render Dimension 2: Interactive 3D Canvas ===
  useEffect(() => {
    if (dimension !== '3d' || !canvas3DRef.current) return;
    const cvs = canvas3DRef.current;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const cw = cvs.width;
    const ch = cvs.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#FDFCF9';
    ctx.fillRect(0, 0, cw, ch);

    const cx = cw * 0.5;
    const cy = ch * 0.53;
    const scale = 68;

    const drawLine3 = (a: [number, number, number], b: [number, number, number], stroke: string, lw = 1.2, dash?: number[]) => {
      const pa = project3D(a[0], a[1], a[2], yaw, pitch, cx, cy, scale);
      const pb = project3D(b[0], b[1], b[2], yaw, pitch, cx, cy, scale);
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(pa.sx, pa.sy);
      ctx.lineTo(pb.sx, pb.sy);
      ctx.stroke();
      ctx.restore();
    };

    const drawLabel3 = (p: [number, number, number], txt: string, color = '#424B54', font = 'bold 12px sans-serif') => {
      const pr = project3D(p[0], p[1], p[2], yaw, pitch, cx, cy, scale);
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.fillText(txt, pr.sx + 5, pr.sy + 4);
    };

    // Draw reference XYZ triad axes
    drawLine3([-2.4, 0, 0], [2.4, 0, 0], '#C6BEB0', 1.1);
    drawLine3([0, -2.4, 0], [0, 2.4, 0], '#C6BEB0', 1.1);
    drawLine3([0, 0, -2.0], [0, 0, 2.1], '#C6BEB0', 1.1);
    drawLabel3([2.45, 0, 0], 'X', '#6E7781');
    drawLabel3([0, 2.45, 0], 'Y', '#6E7781');
    drawLabel3([0, 0, 2.15], 'Z', '#6E7781');

    if (model3D === 'dihedral') {
      const rad = (dihedralDeg * Math.PI) / 180;
      const drawPoly = (pts: [number, number, number][], fill: string, stroke: string) => {
        ctx.save();
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        pts.forEach((pt, idx) => {
          const p = project3D(pt[0], pt[1], pt[2], yaw, pitch, cx, cy, scale);
          if (idx === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
      // Plane Alpha (horizontal reference)
      drawPoly([[0, -1.9, 0], [2.2, -1.9, 0], [2.2, 1.9, 0], [0, 1.9, 0]], 'rgba(27, 77, 62, 0.14)', '#1B4D3E');
      // Plane Beta rotated around Y-axis by dihedralDeg
      const bx = 2.2 * Math.cos(rad);
      const bz = 2.2 * Math.sin(rad);
      drawPoly([[0, -1.9, 0], [bx, -1.9, bz], [bx, 1.9, bz], [0, 1.9, 0]], 'rgba(180, 59, 42, 0.14)', '#B43B2A');
      // Hinge Spine Edge l
      drawLine3([0, -2.1, 0], [0, 2.1, 0], '#14191F', 2.8);
      drawLabel3([0, 2.15, 0], '棱 l', '#14191F');
      // Perpendicular rays in alpha & beta at y=0
      drawLine3([0, 0, 0], [1.6, 0, 0], '#1B4D3E', 2.4);
      drawLine3([0, 0, 0], [1.6 * Math.cos(rad), 0, 1.6 * Math.sin(rad)], '#B43B2A', 2.4);
      // Normals n1 (straight up), n2 (perpendicular to rotated plane)
      drawLine3([1.1, 0, 0], [1.1, 0, 1.2], '#1B4D3E', 2.0, [4, 3]);
      drawLabel3([1.1, 0, 1.25], 'n₁', '#1B4D3E');
      const nx2 = Math.sin(rad);
      const nz2 = -Math.cos(rad);
      drawLine3([bx * 0.5, 0, bz * 0.5], [bx * 0.5 - 1.1 * nx2, 0, bz * 0.5 - 1.1 * nz2], '#B43B2A', 2.0, [4, 3]);
      drawLabel3([bx * 0.5 - 1.15 * nx2, 0, bz * 0.5 - 1.15 * nz2], 'n₂', '#B43B2A');
      return;
    }

    if (model3D === 'vsepr') {
      type AtomSpec = { pos: [number, number, number]; r: number; fill: string; stroke: string; label: string; isLone?: boolean };
      const atoms: AtomSpec[] = [];
      const bonds: [AtomSpec, AtomSpec][] = [];
      if (vseprMolecule === 'CH4') {
        const c: AtomSpec = { pos: [0, 0, 0], r: 22, fill: '#2B3138', stroke: '#14191F', label: 'C (sp³)' };
        const pts: [number, number, number][] = [
          [0, 0, 1.7],
          [1.6, 0, -0.57],
          [-0.8, 1.39, -0.57],
          [-0.8, -1.39, -0.57],
        ];
        atoms.push(c);
        pts.forEach((p, i) => {
          const h: AtomSpec = { pos: p, r: 13, fill: '#E6EFEA', stroke: '#1B4D3E', label: `H${i + 1}` };
          atoms.push(h);
          bonds.push([c, h]);
        });
      } else if (vseprMolecule === 'NH3') {
        const n: AtomSpec = { pos: [0, 0, 0.15], r: 22, fill: '#1B4D3E', stroke: '#12362B', label: 'N (sp³)' };
        const lone: AtomSpec = { pos: [0, 0, 1.65], r: 26, fill: 'rgba(217, 119, 6, 0.28)', stroke: '#9A5B13', label: '孤对电子云', isLone: true };
        const pts: [number, number, number][] = [
          [1.55, 0, -0.68],
          [-0.78, 1.35, -0.68],
          [-0.78, -1.35, -0.68],
        ];
        atoms.push(n, lone);
        bonds.push([n, lone]);
        pts.forEach((p, i) => {
          const h: AtomSpec = { pos: p, r: 13, fill: '#FDFCF9', stroke: '#1B4D3E', label: `H${i + 1}` };
          atoms.push(h);
          bonds.push([n, h]);
        });
      } else {
        // H2O 104.5 deg V-shape + 2 lone pairs
        const o: AtomSpec = { pos: [0, 0, 0], r: 23, fill: '#B43B2A', stroke: '#7F1D1D', label: 'O (104.5°)' };
        const ha = (52.25 * Math.PI) / 180;
        const h1: AtomSpec = { pos: [1.65 * Math.sin(ha), 0, -1.65 * Math.cos(ha)], r: 13, fill: '#FDFCF9', stroke: '#1B4D3E', label: 'H₁' };
        const h2: AtomSpec = { pos: [-1.65 * Math.sin(ha), 0, -1.65 * Math.cos(ha)], r: 13, fill: '#FDFCF9', stroke: '#1B4D3E', label: 'H₂' };
        const l1: AtomSpec = { pos: [0, 1.35, 1.15], r: 25, fill: 'rgba(217, 119, 6, 0.28)', stroke: '#9A5B13', label: '孤对电子 1', isLone: true };
        const l2: AtomSpec = { pos: [0, -1.35, 1.15], r: 25, fill: 'rgba(217, 119, 6, 0.28)', stroke: '#9A5B13', label: '孤对电子 2', isLone: true };
        atoms.push(o, h1, h2, l1, l2);
        bonds.push([o, h1], [o, h2], [o, l1], [o, l2]);
      }

      // Draw bonds
      bonds.forEach(([a, b]) => {
        drawLine3(a.pos, b.pos, b.isLone ? '#9A5B13' : '#424B54', b.isLone ? 1.8 : 4.0, b.isLone ? [4, 4] : undefined);
      });
      // Sort atoms back-to-front by depth
      const projected = atoms
        .map((a) => ({ a, pr: project3D(a.pos[0], a.pos[1], a.pos[2], yaw, pitch, cx, cy, scale) }))
        .sort((u, v) => v.pr.depth - u.pr.depth);

      projected.forEach(({ a, pr }) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pr.sx, pr.sy, a.r, 0, Math.PI * 2);
        ctx.fillStyle = a.fill;
        ctx.fill();
        ctx.strokeStyle = a.stroke;
        ctx.lineWidth = a.isLone ? 1.4 : 2;
        if (a.isLone) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = a.fill === '#1B4D3E' || a.fill === '#B43B2A' || a.fill === '#2B3138' ? '#FFFFFF' : '#14191F';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(a.label, pr.sx, pr.sy + (a.isLone ? 3 : 4));
        ctx.textAlign = 'left';
      });
      return;
    }

    // Build 3D Surface Grid (presets or backend grid)
    let xArr: number[] = [];
    let yArr: number[] = [];
    let zGrid: (number | null)[][] = [];
    let zMin = -2;
    let zMax = 2;

    if (model3D === 'custom_3d' && surfaceData?.ok) {
      xArr = surfaceData.x_vals;
      yArr = surfaceData.y_vals;
      zGrid = surfaceData.z_grid;
      zMin = surfaceData.z_domain[0];
      zMax = surfaceData.z_domain[1];
    } else {
      const G = 21;
      for (let i = 0; i < G; i++) {
        xArr.push(-2.1 + (i / (G - 1)) * 4.2);
        yArr.push(-2.1 + (i / (G - 1)) * 4.2);
      }
      zGrid = yArr.map((yv) =>
        xArr.map((xv) => {
          if (model3D === 'saddle') return (xv * xv - yv * yv) * 0.45;
          if (model3D === 'complex_surface') {
            const r = Math.hypot(xv, yv);
            const rePart = Math.sqrt(Math.max(0, (r + xv) * 0.5));
            return (yv >= 0 ? 1 : -1) * rePart * 0.85;
          }
          if (model3D === 'wave_interf') {
            const d1 = Math.hypot(xv + 0.9, yv);
            const d2 = Math.hypot(xv - 0.9, yv);
            return 0.65 * (Math.cos(3.4 * d1) / (1 + 0.35 * d1) + Math.cos(3.4 * d2) / (1 + 0.35 * d2));
          }
          // peaks
          return (
            1.4 * Math.exp(-((xv - 0.7) ** 2 + (yv - 0.6) ** 2)) -
            1.2 * Math.exp(-((xv + 0.8) ** 2 + (yv + 0.7) ** 2)) +
            0.35 * Math.cos(xv * 1.4)
          );
        })
      );
      zMin = -1.6;
      zMax = 1.6;
    }

    const zSpan = Math.max(0.2, zMax - zMin);
    const xSpan = Math.max(0.5, xArr[xArr.length - 1] - xArr[0]);
    const ySpan = Math.max(0.5, yArr[yArr.length - 1] - yArr[0]);
    const normX = (xv: number) => ((xv - xArr[0]) / xSpan) * 3.8 - 1.9;
    const normY = (yv: number) => ((yv - yArr[0]) / ySpan) * 3.8 - 1.9;
    const normZ = (zv: number) => ((zv - zMin) / zSpan) * 2.3 - 1.1;

    // Optional base contour / grid floor at z = -1.35
    if (showContour3D) {
      for (let k = -2; k <= 2; k++) {
        drawLine3([-2, k * 0.9, -1.35], [2, k * 0.9, -1.35], '#EDE8DD', 0.8);
        drawLine3([k * 0.9, -2, -1.35], [k * 0.9, 2, -1.35], '#EDE8DD', 0.8);
      }
    }

    type Quad = { pts: { sx: number; sy: number }[]; depth: number; zNorm: number };
    const quads: Quad[] = [];
    for (let r = 0; r < yArr.length - 1; r++) {
      for (let c = 0; c < xArr.length - 1; c++) {
        const z00 = zGrid[r][c];
        const z10 = zGrid[r][c + 1];
        const z11 = zGrid[r + 1][c + 1];
        const z01 = zGrid[r + 1][c];
        if (z00 === null || z10 === null || z11 === null || z01 === null) continue;
        const p00 = project3D(normX(xArr[c]), normY(yArr[r]), normZ(z00), yaw, pitch, cx, cy, scale);
        const p10 = project3D(normX(xArr[c + 1]), normY(yArr[r]), normZ(z10), yaw, pitch, cx, cy, scale);
        const p11 = project3D(normX(xArr[c + 1]), normY(yArr[r + 1]), normZ(z11), yaw, pitch, cx, cy, scale);
        const p01 = project3D(normX(xArr[c]), normY(yArr[r + 1]), normZ(z01), yaw, pitch, cx, cy, scale);
        const zAvg = (z00 + z10 + z11 + z01) * 0.25;
        const zNorm = Math.max(0, Math.min(1, (zAvg - zMin) / zSpan));
        quads.push({
          pts: [p00, p10, p11, p01],
          depth: (p00.depth + p10.depth + p11.depth + p01.depth) * 0.25,
          zNorm,
        });
      }
    }

    quads.sort((a, b) => b.depth - a.depth);
    for (const q of quads) {
      // Smooth Editorial Palette Gradient: Vermilion Deep Valley -> Warm Linen -> Pine Green Peak
      const rCol = Math.round(180 * (1 - q.zNorm) + 27 * q.zNorm);
      const gCol = Math.round(59 * (1 - q.zNorm) + 77 * q.zNorm);
      const bCol = Math.round(42 * (1 - q.zNorm) + 62 * q.zNorm);
      ctx.fillStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.78)`;
      ctx.strokeStyle = 'rgba(253, 252, 249, 0.45)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      q.pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.sx, pt.sy) : ctx.lineTo(pt.sx, pt.sy)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }, [dimension, model3D, yaw, pitch, dihedralDeg, vseprMolecule, showContour3D, surfaceData]);

  // === Render Dimension 3: Dynamical Phase Space & Vector Field Canvas ===
  useEffect(() => {
    if (dimension !== 'phase' || !canvasPhaseRef.current) return;
    const cvs = canvasPhaseRef.current;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    // Lorenz dual initial state
    let s1 = { x: 1.0, y: 1.0, z: 1.0 };
    let s2 = { x: 1.001, y: 1.0, z: 1.0 };
    const tr1: [number, number, number][] = [];
    const tr2: [number, number, number][] = [];

    const drawFrame = () => {
      const cw = cvs.width;
      const ch = cvs.height;
      ctx.fillStyle = '#FDFCF9';
      ctx.fillRect(0, 0, cw, ch);

      if (phaseModel === 'lorenz') {
        const sigma = 10;
        const beta = 8 / 3;
        const rho = lorenzRho;
        const dt = 0.009;
        const steps = phasePlaying ? 6 : tr1.length === 0 ? 450 : 0;
        for (let i = 0; i < steps; i++) {
          const stepState = (s: { x: number; y: number; z: number }) => ({
            x: s.x + sigma * (s.y - s.x) * dt,
            y: s.y + (s.x * (rho - s.z) - s.y) * dt,
            z: s.z + (s.x * s.y - beta * s.z) * dt,
          });
          s1 = stepState(s1);
          s2 = stepState(s2);
          tr1.push([s1.x / 12, s1.y / 12, (s1.z - 25) / 14]);
          tr2.push([s2.x / 12, s2.y / 12, (s2.z - 25) / 14]);
          if (tr1.length > 900) { tr1.shift(); tr2.shift(); }
        }
        const renderTrail = (pts: [number, number, number][], stroke: string) => {
          ctx.beginPath();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.6;
          pts.forEach((pt, idx) => {
            const p = project3D(pt[0], pt[1], pt[2], phaseYaw, 0.35, cw * 0.5, ch * 0.54, 72);
            if (idx === 0) ctx.moveTo(p.sx, p.sy);
            else ctx.lineTo(p.sx, p.sy);
          });
          ctx.stroke();
        };
        renderTrail(tr1, '#1B4D3E');
        renderTrail(tr2, 'rgba(180, 59, 42, 0.78)');
        ctx.fillStyle = '#424B54';
        ctx.font = '12px sans-serif';
        ctx.fillText(`双初值相差 0.001 (绿线 vs 朱砂红) ｜ Rayleigh ρ = ${rho}`, 14, 22);
      } else if (phaseModel === 'lotka') {
        const a = lotkaAlpha;
        const b = 0.6;
        const d = 0.45;
        const c = 0.8;
        const padX = 56;
        const padY = 26;
        const gw = cw - 92;
        const gh = ch - 60;
        const toPX = (x: number) => padX + (x / 5.5) * gw;
        const toPY = (y: number) => padY + gh - (y / 4.8) * gh;

        // Axes & Vector quiver field
        ctx.strokeStyle = '#8C959F';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(padX, padY);
        ctx.lineTo(padX, padY + gh);
        ctx.lineTo(padX + gw, padY + gh);
        ctx.stroke();

        for (let ix = 0.35; ix <= 5.2; ix += 0.48) {
          for (let iy = 0.35; iy <= 4.4; iy += 0.45) {
            const vx = a * ix - b * ix * iy;
            const vy = d * ix * iy - c * iy;
            const mag = Math.hypot(vx, vy) || 1;
            const ux = (vx / mag) * 14;
            const uy = (vy / mag) * 14;
            const sx = toPX(ix);
            const sy = toPY(iy);
            ctx.strokeStyle = 'rgba(27, 77, 62, 0.32)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + ux, sy - uy);
            ctx.stroke();
          }
        }
        // Closed phase orbits
        [
          { x0: 2.2, y0: 2.2, col: '#1B4D3E' },
          { x0: 3.1, y0: 2.8, col: '#B43B2A' },
        ].forEach((seed) => {
          let x = seed.x0;
          let y = seed.y0;
          ctx.beginPath();
          ctx.strokeStyle = seed.col;
          ctx.lineWidth = 2;
          for (let k = 0; k < 560; k++) {
            const px = toPX(x);
            const py = toPY(y);
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
            const dx = a * x - b * x * y;
            const dy = d * x * y - c * y;
            x = Math.max(0.05, x + dx * 0.025);
            y = Math.max(0.05, y + dy * 0.025);
          }
          ctx.stroke();
        });
        // Equilibrium point
        const eqX = c / d;
        const eqY = a / b;
        ctx.fillStyle = '#9A5B13';
        ctx.beginPath();
        ctx.arc(toPX(eqX), toPY(eqY), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#14191F';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`不动平衡中心 (${eqX.toFixed(2)}, ${eqY.toFixed(2)})`, toPX(eqX) + 8, toPY(eqY) - 6);
        ctx.fillStyle = '#424B54';
        ctx.fillText('纵轴: 捕食者 (狼)  ｜  横轴: 被捕食者 (羊)', padX, ch - 10);
      } else {
        // Electromagnetic Dipole field lines & equipotentials
        const cx = cw * 0.5;
        const cy = ch * 0.5;
        const qSep = 115;
        const pxPos = cx - qSep;
        const nxPos = cx + qSep;

        // Quiver field
        for (let gx = 40; gx < cw - 20; gx += 38) {
          for (let gy = 30; gy < ch - 20; gy += 36) {
            const dx1 = gx - pxPos;
            const dy1 = gy - cy;
            const r1 = Math.max(22, Math.hypot(dx1, dy1));
            const dx2 = gx - nxPos;
            const dy2 = gy - cy;
            const r2 = Math.max(22, Math.hypot(dx2, dy2));
            const ex = dx1 / r1 ** 3 - dx2 / r2 ** 3;
            const ey = dy1 / r1 ** 3 - dy2 / r2 ** 3;
            const em = Math.hypot(ex, ey) || 1;
            ctx.strokeStyle = 'rgba(27, 77, 62, 0.35)';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx + (ex / em) * 14, gy + (ey / em) * 14);
            ctx.stroke();
          }
        }
        // Trace field streamlines from +q
        for (let a = 0; a < 10; a++) {
          const ang = (a / 10) * Math.PI * 2;
          let x = pxPos + Math.cos(ang) * 16;
          let y = cy + Math.sin(ang) * 16;
          ctx.beginPath();
          ctx.strokeStyle = '#1B4D3E';
          ctx.lineWidth = 1.6;
          for (let s = 0; s < 140; s++) {
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            const dx1 = x - pxPos;
            const dy1 = y - cy;
            const r1 = Math.max(8, Math.hypot(dx1, dy1));
            const dx2 = x - nxPos;
            const dy2 = y - cy;
            const r2 = Math.max(8, Math.hypot(dx2, dy2));
            if (r2 < 14) break;
            const ex = dx1 / r1 ** 3 - dx2 / r2 ** 3;
            const ey = dy1 / r1 ** 3 - dy2 / r2 ** 3;
            const em = Math.hypot(ex, ey) || 1;
            x += (ex / em) * 4.5;
            y += (ey / em) * 4.5;
            if (x < 0 || x > cw || y < 0 || y > ch) break;
          }
          ctx.stroke();
        }
        // Draw charges +q and -q
        ctx.fillStyle = '#B43B2A';
        ctx.beginPath(); ctx.arc(pxPos, cy, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('+q', pxPos, cy + 4);
        ctx.fillStyle = '#1B4D3E';
        ctx.beginPath(); ctx.arc(nxPos, cy, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('-q', nxPos, cy + 4);
        ctx.textAlign = 'left';
      }

      if (phasePlaying && phaseModel === 'lorenz') {
        animId = window.requestAnimationFrame(drawFrame);
      }
    };

    drawFrame();
    return () => {
      if (animId) window.cancelAnimationFrame(animId);
    };
  }, [dimension, phaseModel, phasePlaying, lorenzRho, lotkaAlpha, phaseYaw]);

  return (
    <div className="paper-folio" style={{ padding: '14px 18px' }} data-testid="function-plot-card">
      {/* Unified Header + 4-Dimension Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border-hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {dimension === 'mindmap' ? (
            <IconMindMap size={17} color="var(--accent)" />
          ) : dimension === '3d' || dimension === 'phase' ? (
            <IconDimensionCube size={17} color="var(--accent)" />
          ) : (
            <IconFunctionCurve size={17} color="var(--accent)" />
          )}
          <span className="serif-heading" style={{ fontSize: 16, fontWeight: 600 }}>
            函数与几何画板
          </span>
        </div>

        <div className="seg-switch" data-testid="workbench-dimension-switch">
          <button
            type="button"
            className={`seg-switch-btn ${dimension === '2d' ? 'active' : ''}`}
            onClick={() => setDimension('2d')}
            data-testid="dim-tab-2d"
          >
            平面函数
          </button>
          <button
            type="button"
            className={`seg-switch-btn ${dimension === '3d' ? 'active' : ''}`}
            onClick={() => setDimension('3d')}
            data-testid="dim-tab-3d"
          >
            三维图形
          </button>
          <button
            type="button"
            className={`seg-switch-btn ${dimension === 'phase' ? 'active' : ''}`}
            onClick={() => setDimension('phase')}
            data-testid="dim-tab-phase"
          >
            动力系统与场
          </button>
          <button
            type="button"
            className={`seg-switch-btn ${dimension === 'mindmap' ? 'active' : ''}`}
            onClick={() => setDimension('mindmap')}
            data-testid="dim-tab-mindmap"
          >
            思维导图
          </button>
        </div>

        {dimension !== 'mindmap' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-surface btn-sm"
              disabled={insertingTarget !== null}
              onClick={() => handleInsertVisual('lesson', dynamic2D?.title, dynamic2D?.formulaLabel)}
              data-testid="btn-insert-plot-lesson"
            >
              <IconLessonDoc size={13} color="var(--accent)" />
              {insertingTarget === 'lesson' ? '插入中…' : '插入教案'}
            </button>
            <button
              type="button"
              className="btn btn-surface btn-sm"
              disabled={insertingTarget !== null}
              onClick={() => handleInsertVisual('ppt', dynamic2D?.title, dynamic2D?.formulaLabel)}
              data-testid="btn-insert-plot-ppt"
            >
              <IconSlideDeck size={13} color="var(--accent)" />
              {insertingTarget === 'ppt' ? '插入中…' : '插入课件'}
            </button>
          </div>
        )}
      </div>

      {insertToast && (
        <div className="callout-verified" style={{ fontSize: 12, marginBottom: 8, padding: '6px 10px' }} data-testid="plot-insert-toast">
          {insertToast}
        </div>
      )}

      {/* ================== DIMENSION 1: 2D FUNCTION & CYCLIC GROUP SANDBOX ================== */}
      {dimension === '2d' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'sympy', label: '自定义函数' },
                  { id: 'cubic_extrema', label: '三次函数极值' },
                  { id: 'cyclic_group', label: '循环群 Z_n' },
                  { id: 'logistic', label: '种群增长曲线' },
                  { id: 'damped_wave', label: '阻尼振动' },
                  { id: 'michaelis', label: '酶促反应' },
                  { id: 'bayes_ppv', label: '条件概率筛查' },
                  { id: 'marginal_econ', label: '边际均衡' },
                ] as { id: Sandbox2DId; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`preset-chip ${sandbox2D === m.id ? 'active-chip' : ''}`}
                  style={sandbox2D === m.id ? { background: 'var(--accent)', color: '#FFFFFF', borderColor: 'var(--accent)' } : undefined}
                  onClick={() => handleSelect2DSandbox(m.id)}
                  data-testid={`sandbox-2d-${m.id}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {sandbox2D === 'sympy' ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
                输入一元函数表达式，绘制原函数与导函数图像并支持切线与极值查看
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  className="input mono-num"
                  style={{ width: 168, padding: '4px 9px', fontSize: 12 }}
                  value={exprInput}
                  onChange={(e) => setExprInput(e.target.value)}
                  placeholder="例如 x^3 - 3*x^2 + 2"
                  aria-label="函数表达式"
                />
                <button type="button" className="btn btn-surface btn-sm" onClick={() => loadPlot(exprInput)} disabled={loading2D}>
                  {loading2D ? '采样…' : '重绘'}
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${showDeriv ? 'btn-primary' : 'btn-surface'}`}
                  onClick={() => setShowDeriv((v) => !v)}
                >
                  {showDeriv ? "隐藏 f'(x)" : "叠加 f'(x)"}
                </button>
              </div>
            </div>
          ) : (
            dynamic2D && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '6px 10px', marginBottom: 8, background: 'var(--bg-subtle)', borderRadius: 6, fontSize: 12 }}>
                <div>
                  <strong style={{ color: 'var(--accent)' }}>{dynamic2D.title}</strong>
                  <div style={{ color: 'var(--ink-secondary)', marginTop: 1 }}>{dynamic2D.formulaLabel}</div>
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }} className="mono-num">
                    {dynamic2D.paramALabel}
                    <input
                      type="range"
                      min={dynamic2D.paramAMin}
                      max={dynamic2D.paramAMax}
                      step={dynamic2D.paramAStep}
                      value={paramA}
                      onChange={(e) => setParamA(Number(e.target.value))}
                      style={{ width: 88, accentColor: '#1B4D3E' }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }} className="mono-num">
                    {dynamic2D.paramBLabel}
                    <input
                      type="range"
                      min={dynamic2D.paramBMin}
                      max={dynamic2D.paramBMax}
                      step={dynamic2D.paramBStep}
                      value={paramB}
                      onChange={(e) => setParamB(Number(e.target.value))}
                      style={{ width: 88, accentColor: '#B43B2A' }}
                    />
                  </label>
                </div>
              </div>
            )
          )}

          {sandbox2D === 'cyclic_group' ? (() => {
            const n = Math.max(4, Math.min(16, Math.round(paramA)));
            const gRaw = Math.max(1, Math.min(15, Math.round(paramB)));
            const g = gRaw % n;
            const stepVal = g === 0 ? n : g;
            const ord = n / gcdInt(n, stepVal);
            const phi = eulerPhi(n);
            const isGen = ord === n;
            const orbit: number[] = [0];
            for (let k = 1; k <= ord; k++) {
              orbit.push((k * g) % n);
            }
            const visited = new Set(orbit);
            const cxG = 230;
            const cyG = H * 0.5;
            const rad = 98;
            const ptPos = (idx: number) => {
              const ang = -Math.PI / 2 + (idx / n) * Math.PI * 2;
              return { x: cxG + Math.cos(ang) * rad, y: cyG + Math.sin(ang) * rad, lx: cxG + Math.cos(ang) * (rad + 18), ly: cyG + Math.sin(ang) * (rad + 18) };
            };
            return (
              <div style={{ border: '1px solid var(--border-hairline)', borderRadius: 6, background: '#FFFFFF', padding: '6px 8px' }} data-testid="cyclic-group-diagram">
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                  <circle cx={cxG} cy={cyG} r={rad} fill="none" stroke="#E5DFD3" strokeWidth="1.4" strokeDasharray="4,3" />
                  {orbit.slice(0, -1).map((u, idx) => {
                    const v = orbit[idx + 1];
                    const p1 = ptPos(u);
                    const p2 = ptPos(v);
                    return (
                      <line
                        key={`chord-${idx}`}
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke={isGen ? '#B43B2A' : '#1B4D3E'}
                        strokeWidth={isGen ? '1.8' : '2.2'}
                        strokeOpacity="0.82"
                      />
                    );
                  })}
                  {Array.from({ length: n }, (_, k) => {
                    const pt = ptPos(k);
                    const inOrbit = visited.has(k);
                    const isCoprime = gcdInt(n, k) === 1;
                    return (
                      <g key={`v-${k}`}>
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={k === 0 ? 7.5 : inOrbit ? 6.2 : 4.5}
                          fill={k === 0 ? '#14191F' : inOrbit ? (isGen ? '#B43B2A' : '#1B4D3E') : '#FDFCF9'}
                          stroke={isCoprime ? '#9A5B13' : '#717A84'}
                          strokeWidth={isCoprime ? '2' : '1.2'}
                        />
                        <text x={pt.lx} y={pt.ly + 4} fontSize="11" fontWeight={inOrbit ? '700' : '400'} fill="#14191F" textAnchor="middle">
                          {k}
                        </text>
                      </g>
                    );
                  })}
                  <g transform="translate(382, 34)">
                    <rect x="0" y="0" width="234" height="196" rx="6" fill="#FAF8F4" stroke="#E5DFD3" strokeWidth="1" />
                    <text x="14" y="26" fontSize="13" fontWeight="700" fill="#14191F">循环群 Z_{n} 阶与子群统计</text>
                    <text x="14" y="52" fontSize="12" fill="#424B54">群的阶：|G| = {n}</text>
                    <text x="14" y="76" fontSize="12" fill={isGen ? '#B43B2A' : '#1B4D3E'} fontWeight="700">当前步长 g = {g} → 子群阶 ord(g) = {ord}</text>
                    <text x="14" y="100" fontSize="12" fill="#424B54">结论：{isGen ? `gcd(${n}, ${g})=1，可遍历全部节点` : `生成 ${ord} 阶真子群`}</text>
                    <text x="14" y="124" fontSize="12" fill="#9A5B13">全群生成元个数：φ({n}) = {phi}</text>
                    <text x="14" y="152" fontSize="11.5" fill="#6E7781">子群元素：{`{${Array.from(visited).sort((a, b) => a - b).join(', ')}}`}</text>
                    <text x="14" y="176" fontSize="11" fill="#6E7781">浅褐环圈为满足 gcd(n, k)=1 的生成元</text>
                  </g>
                </svg>
              </div>
            );
          })() : dynamic2D || plot?.ok ? (
            <>
              <div style={{ border: '1px solid var(--border-hairline)', borderRadius: 6, background: '#FFFFFF', padding: '6px 8px' }}>
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                  <defs>
                    <clipPath id="tutor-plot-clip">
                      <rect x={px0} y={py0} width={pw} height={ph} />
                    </clipPath>
                  </defs>
                  {yTicks.map((yt) => (
                    <line key={`gy-${yt}`} x1={px0} y1={toY(yt)} x2={px0 + pw} y2={toY(yt)} stroke="#E8E3D9" strokeWidth="1" strokeDasharray="3,3" />
                  ))}
                  {xTicks.map((xt) => (
                    <line key={`gx-${xt}`} x1={toX(xt)} y1={py0} x2={toX(xt)} y2={py0 + ph} stroke="#E8E3D9" strokeWidth="1" strokeDasharray="3,3" />
                  ))}
                  {yLo <= 0 && yHi >= 0 && (
                    <>
                      <line x1={px0} y1={toY(0)} x2={px0 + pw} y2={toY(0)} stroke="#717A84" strokeWidth="1.4" />
                      <polygon points={`${px0 + pw + 7},${toY(0)} ${px0 + pw - 1},${toY(0) - 3.5} ${px0 + pw - 1},${toY(0) + 3.5}`} fill="#717A84" />
                    </>
                  )}
                  {xLo <= 0 && xHi >= 0 && (
                    <>
                      <line x1={toX(0)} y1={py0 + ph} x2={toX(0)} y2={py0} stroke="#717A84" strokeWidth="1.4" />
                      <polygon points={`${toX(0)},${py0 - 7} ${toX(0) - 3.5},${py0 + 1} ${toX(0) + 3.5},${py0 + 1}`} fill="#717A84" />
                    </>
                  )}
                  {xLo <= 0 && xHi >= 0 && yLo <= 0 && yHi >= 0 && (
                    <text x={toX(0) - 8} y={Math.min(py0 + ph - 4, toY(0) + 14)} fontSize="11" fontWeight="700" fill="#6E7781" textAnchor="end">
                      O
                    </text>
                  )}

                  {yTicks.map((yt) => (
                    <text key={`yt-${yt}`} x={px0 - 7} y={toY(yt) + 3.5} fontSize="10.5" fill="#6E7781" textAnchor="end">
                      {fmtTick(yt)}
                    </text>
                  ))}

                  <g transform={`translate(${px0 + pw - 210}, ${py0 - 12})`}>
                    <rect x="0" y="-6" width="208" height="20" rx="4" fill="#FDFCF9" fillOpacity="0.94" stroke="#E5DFD3" strokeWidth="1" />
                    <line x1="8" y1="4" x2="22" y2="4" stroke="#1B4D3E" strokeWidth="2.4" />
                    <text x="26" y="7.5" fontSize="10" fontWeight="600" fill="#14191F">{dynamic2D ? dynamic2D.fLegend : 'f(x)'}</text>
                    <line x1="108" y1="4" x2="122" y2="4" stroke="#B43B2A" strokeWidth="1.8" strokeDasharray="4,3" />
                    <text x="126" y="7.5" fontSize="10" fontWeight="600" fill="#B43B2A">{dynamic2D ? dynamic2D.dfLegend : "f'(x)"}</text>
                  </g>

                  <g clipPath="url(#tutor-plot-clip)">
                    {dynamic2D ? (
                      <>
                        {showDeriv && (
                          <polyline
                            fill="none"
                            stroke="#B43B2A"
                            strokeOpacity="0.72"
                            strokeWidth="1.8"
                            strokeDasharray="5,4"
                            points={dynamic2D.dfPts.map((pt) => `${toX(pt[0]).toFixed(1)},${toY(pt[1]).toFixed(1)}`).join(' ')}
                          />
                        )}
                        <polyline
                          fill="none"
                          stroke="#1B4D3E"
                          strokeWidth="2.8"
                          points={dynamic2D.fPts.map((pt) => `${toX(pt[0]).toFixed(1)},${toY(pt[1]).toFixed(1)}`).join(' ')}
                        />
                      </>
                    ) : (
                      <>
                        {showDeriv &&
                          (plot?.df_segments || []).map((seg, idx) => (
                            <polyline
                              key={`df-${idx}`}
                              fill="none"
                              stroke="#B43B2A"
                              strokeOpacity="0.72"
                              strokeWidth="1.8"
                              strokeDasharray="5,4"
                              points={seg.map((pt) => `${toX(pt[0]).toFixed(1)},${toY(pt[1]).toFixed(1)}`).join(' ')}
                            />
                          ))}
                        {(plot?.f_segments || []).map((seg, idx) => (
                          <polyline
                            key={`f-${idx}`}
                            fill="none"
                            stroke="#1B4D3E"
                            strokeWidth="2.8"
                            points={seg.map((pt) => `${toX(pt[0]).toFixed(1)},${toY(pt[1]).toFixed(1)}`).join(' ')}
                          />
                        ))}
                      </>
                    )}
                  </g>

                  {(dynamic2D ? dynamic2D.highlights : (plot?.critical_points || []).map((cp) => ({ x: cp.x, y: cp.y, label: `${cp.kind_cn} (${cp.x})` }))).map((hl, idx) => {
                    const cxp = toX(hl.x);
                    const cyp = Math.max(py0 + 16, Math.min(py0 + ph - 16, toY(hl.y)));
                    const lblX = Math.min(px0 + pw - 134, Math.max(px0 + 12, cxp + 10));
                    const lblY = idx % 2 === 1 ? Math.min(py0 + ph - 10, cyp + 22) : Math.max(py0 + 18, cyp - 16);
                    return (
                      <g key={`hl-${idx}`}>
                        <line x1={cxp} y1={cyp} x2={lblX} y2={lblY - 4} stroke="#B43B2A" strokeOpacity="0.45" strokeWidth="1" />
                        <rect x={lblX - 4} y={lblY - 13} width={Math.max(96, hl.label.length * 7.5)} height="17" rx="3" fill="#FDFCF9" fillOpacity="0.93" />
                        <circle cx={cxp} cy={cyp} r="4.5" fill="#FDFCF9" stroke="#B43B2A" strokeWidth="2.2" />
                        <text x={lblX} y={lblY - 1} fontSize="10.2" fontWeight="700" fill="#B43B2A">
                          {hl.label}
                        </text>
                      </g>
                    );
                  })}

                  {activeSample && tangentLine && (
                    <g clipPath="url(#tutor-plot-clip)">
                      <line x1={toX(activeSample.x)} y1={py0} x2={toX(activeSample.x)} y2={py0 + ph} stroke="#9A5B13" strokeOpacity="0.3" strokeWidth="1.2" strokeDasharray="3,3" />
                      <line x1={tangentLine.x1} y1={tangentLine.y1} x2={tangentLine.x2} y2={tangentLine.y2} stroke="#9A5B13" strokeWidth="2.2" />
                      <circle cx={toX(activeSample.x)} cy={toY(activeSample.y)} r="5.5" fill="#9A5B13" stroke="#FDFCF9" strokeWidth="2" />
                    </g>
                  )}

                  {xTicks.map((xt) => (
                    <text key={`xt-${xt}`} x={toX(xt)} y={H - 8} fontSize="10.5" fill="#6E7781" textAnchor="middle">
                      {fmtTick(xt)}
                    </text>
                  ))}
                </svg>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 210 }}>
                  <span className="mono-num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>
                    点位 x₀ = {activeSample?.x?.toFixed(2) ?? xCursor.toFixed(2)}
                  </span>
                  <input
                    type="range"
                    min={xLo}
                    max={xHi}
                    step={Math.max(0.01, (xHi - xLo) / 100)}
                    value={xCursor}
                    onChange={(e) => setXCursor(Number(e.target.value))}
                    style={{ flex: 1, accentColor: '#1B4D3E' }}
                  />
                </div>
                {activeSample && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="stamp-badge stamp-neutral mono-num">f(x₀) = {activeSample.y.toFixed(2)}</span>
                    <span className="stamp-badge stamp-accent mono-num">f'(x₀) = {activeSample.dy.toFixed(2)}</span>
                    <span className="stamp-badge stamp-verified">{slopeSign}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--seal)', padding: '12px 4px' }}>
              {plot?.error || '请输入一元函数后点击重绘'}
            </div>
          )}
        </div>
      )}

      {/* ================== DIMENSION 2: 3D SURFACE & GEOMETRY ================== */}
      {dimension === '3d' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="sandbox-3d-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'saddle', label: '马鞍面 z=x²-y²' },
                  { id: 'complex_surface', label: '复变黎曼面' },
                  { id: 'wave_interf', label: '双波干涉' },
                  { id: 'dihedral', label: '二面角翻折' },
                  { id: 'vsepr', label: '分子空间构型' },
                  { id: 'peaks', label: '等高地形' },
                ] as { id: Model3DId; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="preset-chip"
                  style={model3D === m.id ? { background: 'var(--accent)', color: '#FFFFFF', borderColor: 'var(--accent)' } : undefined}
                  onClick={() => setModel3D(m.id)}
                  data-testid={`model-3d-${m.id}`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input mono-num"
                style={{ width: 145, padding: '4px 8px', fontSize: 12 }}
                value={expr3DInput}
                onChange={(e) => setExpr3DInput(e.target.value)}
                placeholder="z = sin(x)*cos(y)"
                data-testid="input-3d-expr"
              />
              <button type="button" className="btn btn-surface btn-sm" onClick={() => loadSurface3D(expr3DInput)} disabled={loading3D} data-testid="btn-plot-3d">
                {loading3D ? '计算中…' : '绘制曲面'}
              </button>
            </div>
          </div>

          {/* Model-specific Interactive Controls */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '6px 10px', background: 'var(--bg-subtle)', borderRadius: 6, fontSize: 12 }}>
            {model3D === 'dihedral' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }} className="mono-num">
                <strong style={{ color: 'var(--accent)' }}>二面角张角 θ = {dihedralDeg}°</strong>
                <span>({dihedralDeg > 90 ? '钝二面角·法向量同内同外互补' : '锐二面角·一内一外相等'})</span>
                <input type="range" min={20} max={165} step={1} value={dihedralDeg} onChange={(e) => setDihedralDeg(Number(e.target.value))} style={{ width: 120, accentColor: '#1B4D3E' }} />
              </label>
            ) : model3D === 'vsepr' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>分子构型：</strong>
                {(['CH4', 'NH3', 'H2O'] as const).map((mol) => (
                  <button
                    key={mol}
                    type="button"
                    className={`btn btn-sm ${vseprMolecule === mol ? 'btn-primary' : 'btn-surface'}`}
                    onClick={() => setVseprMolecule(mol)}
                  >
                    {mol === 'CH4' ? 'CH₄ 正四面体 (109.5°)' : mol === 'NH3' ? 'NH₃ 三角锥 (107°·含1孤对)' : 'H₂O V字形 (104.5°·2孤对压角)'}
                  </button>
                ))}
              </div>
            ) : model3D === 'complex_surface' ? (
              <span style={{ color: 'var(--ink-secondary)' }}>
                复平方根实部 Re(√(x+iy)) 曲面：沿负实轴 x &lt; 0 出现正负分支跃迁（支割线），拖动可旋转观察
              </span>
            ) : model3D === 'custom_3d' && surfaceData?.ok ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="stamp-badge stamp-verified">{surfaceData.surface_feature}</span>
                <span className="mono-num">∂z/∂x = {surfaceData.fx_latex} ｜ ∂z/∂y = {surfaceData.fy_latex}</span>
              </div>
            ) : (
              <span style={{ color: 'var(--ink-secondary)' }}>
                按住画布可拖动旋转三维视角，观察曲面高低与凹凸特征
              </span>
            )}
            <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showContour3D} onChange={(e) => setShowContour3D(e.target.checked)} />
              <span>显示底投影网格</span>
            </label>
          </div>

          <div style={{ border: '1px solid var(--border-hairline)', borderRadius: 6, background: '#FDFCF9', overflow: 'hidden', position: 'relative' }}>
            <canvas
              ref={canvas3DRef}
              width={680}
              height={320}
              style={{ width: '100%', height: 'auto', display: 'block', cursor: 'grab' }}
              onMouseDown={(e) => { drag3DRef.current = { down: true, lx: e.clientX, ly: e.clientY }; }}
              onMouseMove={(e) => {
                if (!drag3DRef.current.down) return;
                const dx = e.clientX - drag3DRef.current.lx;
                const dy = e.clientY - drag3DRef.current.ly;
                drag3DRef.current = { down: true, lx: e.clientX, ly: e.clientY };
                setYaw((w) => w + dx * 0.01);
                setPitch((p) => Math.max(-1.3, Math.min(1.3, p + dy * 0.01)));
              }}
              onMouseUp={() => { drag3DRef.current.down = false; }}
              onMouseLeave={() => { drag3DRef.current.down = false; }}
            />
            <div style={{ position: 'absolute', bottom: 6, right: 10, fontSize: 11, color: 'var(--ink-muted)', pointerEvents: 'none' }} className="mono-num">
              Yaw {Math.round((yaw * 180) / Math.PI)}° · Pitch {Math.round((pitch * 180) / Math.PI)}°（拖动旋转）
            </div>
          </div>
        </div>
      )}

      {/* ================== DIMENSION 3: DYNAMICAL PHASE SPACE & VECTOR FIELDS ================== */}
      {dimension === 'phase' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="sandbox-phase-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'lorenz', label: '混沌/气象·洛伦兹 3D 蝴蝶吸引子' },
                  { id: 'lotka', label: '生态/博弈·捕食-猎物相空间轨线' },
                  { id: 'dipole', label: '电磁学·正负偶极子场线与流场' },
                ] as { id: PhaseModelId; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="preset-chip"
                  style={phaseModel === m.id ? { background: 'var(--accent)', color: '#FFFFFF', borderColor: 'var(--accent)' } : undefined}
                  onClick={() => setPhaseModel(m.id)}
                  data-testid={`phase-model-${m.id}`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {phaseModel === 'lorenz' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="mono-num" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                  ρ={lorenzRho}
                  <input type="range" min={14} max={34} step={1} value={lorenzRho} onChange={(e) => setLorenzRho(Number(e.target.value))} style={{ width: 78, accentColor: '#1B4D3E' }} />
                </label>
                <button type="button" className="btn btn-surface btn-sm" onClick={() => setPhasePlaying((p) => !p)}>
                  {phasePlaying ? '暂停演化' : '继续演化'}
                </button>
              </div>
            )}

            {phaseModel === 'lotka' && (
              <label className="mono-num" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                猎物再生 α={lotkaAlpha.toFixed(1)}
                <input type="range" min={0.6} max={2.2} step={0.1} value={lotkaAlpha} onChange={(e) => setLotkaAlpha(Number(e.target.value))} style={{ width: 88, accentColor: '#1B4D3E' }} />
              </label>
            )}
          </div>

          <div style={{ border: '1px solid var(--border-hairline)', borderRadius: 6, background: '#FDFCF9', overflow: 'hidden', position: 'relative' }}>
            <canvas
              ref={canvasPhaseRef}
              width={680}
              height={320}
              style={{ width: '100%', height: 'auto', display: 'block', cursor: phaseModel === 'lorenz' ? 'grab' : 'default' }}
              onMouseDown={(e) => { dragPhaseRef.current = { down: true, lx: e.clientX }; }}
              onMouseMove={(e) => {
                if (!dragPhaseRef.current.down || phaseModel !== 'lorenz') return;
                const dx = e.clientX - dragPhaseRef.current.lx;
                dragPhaseRef.current.lx = e.clientX;
                setPhaseYaw((w) => w + dx * 0.012);
              }}
              onMouseUp={() => { dragPhaseRef.current.down = false; }}
              onMouseLeave={() => { dragPhaseRef.current.down = false; }}
            />
          </div>
        </div>
      )}

      {/* ================== DIMENSION 4: MINDMAP / DRAW.IO ================== */}
      {dimension === 'mindmap' && (
        <MindMapDrawioWorkbench
          compact
          subject={subject}
          domainId={domainId}
          branch={branch}
          externalMap={externalMindmap}
          onExpandFull={onExpandMindmap}
          onArtifactsChanged={onArtifactsChanged}
        />
      )}
    </div>
  );
};
