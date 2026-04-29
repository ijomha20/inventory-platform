import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  useGetMe,
  useGetLenderPrograms,
  useGetLenderStatus,
  useRefreshLender,
  useLenderCalculate,
  getGetMeQueryKey,
  getGetLenderProgramsQueryKey,
  getGetLenderStatusQueryKey,
} from "@workspace/api-client-react";
import type {
  LenderProgram,
  LenderProgramGuide,
  LenderProgramTier,
  LenderCalcResultItem,
  LenderCalculateResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Calculator, Car, AlertCircle, Eye, ChevronDown, ChevronUp } from "lucide-react";

function formatCurrency(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function formatPayment(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const COND_SHORT: Record<string, string> = { extraClean: "XC", clean: "C", average: "A", rough: "R" };

const BINDING_LABEL: Record<string, string> = {
  online: "On",
  advance: "Adv",
  allIn: "AllIn",
  payment: "Pmt",
  pacFloor: "PAC",
  none: "—",
};

interface OpsCheck {
  pass: boolean;
}

interface OpsFunctionStatusResponse {
  inventoryCount: number;
  checks: {
    blackBookUpdatedWithin24Hours: OpsCheck & {
      lastRunAt: string | null;
      running: boolean;
      valuedInventoryCount: number;
    };
    carfaxLookupActivity: OpsCheck & {
      attemptedCount: number;
      foundUrlCount: number;
      notFoundCount: number;
    };
    websiteLinkDiscovery: OpsCheck & {
      foundUrlCount: number;
      notFoundCount: number;
      coveragePct: number;
    };
    lenderProgramsLoaded: OpsCheck & {
      lenderProgramCount: number;
      updatedAt: string | null;
      running: boolean;
      error: string | null;
    };
  };
}

function OpsCheckBadge({ pass }: { pass: boolean }) {
  return (
    <Badge
      variant="outline"
      className={pass ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}
    >
      {pass ? "PASS" : "FAIL"}
    </Badge>
  );
}

function ResultRow({ item, rank, showDP }: { item: any; rank: number; showDP: boolean }) {
  const needsDP = (item.requiredDownPayment ?? 0) > 0;
  const stretched = item.termStretched === true;
  const applied = Number(item.termStretchApplied ?? 0);
  const binding = String(item.bindingSellingConstraint ?? "none");
  let rowBg = "odd:bg-white even:bg-slate-50/40";
  if (needsDP) rowBg = "bg-gray-100/60";
  else if (binding === "pacFloor") rowBg = "bg-rose-50/60";
  else if (binding !== "online" && binding !== "none") rowBg = "bg-blue-50/40";
  else if (stretched && applied === 12) rowBg = "bg-orange-50";
  else if (stretched && applied === 6) rowBg = "bg-amber-50";

  const totalGross = Number(item.totalGross ?? 0);
  const frontEndGross = Number(item.frontEndGross ?? 0);
  const nonCancelable = Number(item.nonCancelableGross ?? 0);
  const cancelable = Number(item.cancelableBackendGross ?? 0);
  const grossTooltip = `Front: ${formatCurrency(frontEndGross)} · Non-cancelable: ${formatCurrency(nonCancelable)} · Cancelable backend: ${formatCurrency(cancelable)}`;

  return (
    <tr className={`border-b border-gray-100 last:border-0 ${rowBg} hover:bg-blue-50/50`}>
      <td className="px-1.5 py-1.5 text-[11px] text-gray-400 font-semibold text-center">{rank}</td>
      <td className="px-2 py-1.5 text-xs font-semibold text-gray-900">
        <div className="truncate" title={item.vehicle}>
          {item.vehicle}
        </div>
      </td>
      <td className="px-1.5 py-1.5 text-xs text-gray-600 whitespace-nowrap">{item.location}</td>
      <td
        className="px-1.5 py-1.5 text-xs text-center text-gray-600 whitespace-nowrap"
        title={
          item.matrixTerm != null
            ? `Matrix ${item.matrixTerm}mo · applied +${applied} → ${item.term}mo${item.termStretchCappedReason ? ` (${item.termStretchCappedReason})` : ""}`
            : undefined
        }
      >
        {item.term}mo
        {item.termStretchCappedReason ? <span className="text-[9px] text-amber-700 ml-0.5 align-super">†</span> : null}
      </td>
      <td className="px-1.5 py-1.5 text-xs text-center text-gray-600 whitespace-nowrap">{COND_SHORT[item.conditionUsed] ?? item.conditionUsed}</td>
      <td className="px-1.5 py-1.5 text-xs text-right font-medium text-gray-600">{formatCurrency(item.bbWholesale)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-medium text-gray-700"
        title={item.onlinePrice != null ? `Online: ${formatCurrency(Number(item.onlinePrice))} · PAC: ${formatCurrency(Number(item.pacCost ?? 0))}` : `PAC: ${formatCurrency(Number(item.pacCost ?? 0))}`}>
        {item.sellingPrice > 0 ? formatCurrency(item.sellingPrice) : "—"}
        <span className="text-[10px] text-gray-400 ml-0.5">
          ({BINDING_LABEL[binding] ?? binding})
        </span>
      </td>
      <td className="px-1.5 py-1.5 text-xs text-right font-medium text-indigo-700">{formatCurrency(item.adminFeeUsed)}</td>
      <td className="px-2 py-1.5 text-xs text-right text-gray-700">
        {formatCurrency(item.warrantyPrice)}
        <span className="text-[10px] text-gray-400 ml-0.5">/{formatCurrency(item.warrantyCost)}</span>
      </td>
      <td className="px-2 py-1.5 text-xs text-right text-gray-700">
        {formatCurrency(item.gapPrice)}
        <span className="text-[10px] text-gray-400 ml-0.5">/{formatCurrency(item.gapCost)}</span>
      </td>
      <td className="px-2 py-1.5 text-xs text-right font-medium text-gray-700">{formatCurrency(item.totalFinanced)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-semibold text-green-700">{formatPayment(item.monthlyPayment)}</td>
      <td className="px-2 py-1.5 text-xs text-right font-semibold text-emerald-700" title={grossTooltip}>
        {formatCurrency(totalGross)}
      </td>
      {showDP && (
        <td className="px-2 py-1.5 text-xs text-right font-semibold text-red-600">
          {needsDP ? formatCurrency(item.requiredDownPayment) : "—"}
        </td>
      )}
    </tr>
  );
}

export default function LenderCalculator() {
  const { data: programsData, isLoading: loadingPrograms, refetch: refetchPrograms } = useGetLenderPrograms({
    query: { queryKey: getGetLenderProgramsQueryKey(), retry: false, refetchOnWindowFocus: false },
  });
  const { data: statusData, refetch: refetchStatus } = useGetLenderStatus({
    query: { queryKey: getGetLenderStatusQueryKey(), retry: false, refetchInterval: 10_000 },
  });
  const { data: meData } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });
  const refreshMutation = useRefreshLender();
  const calcMutation = useLenderCalculate();
  const [opsStatus, setOpsStatus] = useState<OpsFunctionStatusResponse | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);

  const [selectedLender, setSelectedLender] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("");
  const [selectedTier, setSelectedTier] = useState("");
  const [approvedRate, setApprovedRate] = useState("14.99");
  const [maxPaymentOverride, setMaxPaymentOverride] = useState("");
  const [downPayment, setDownPayment] = useState("0");
  const [tradeValue, setTradeValue] = useState("0");
  const [tradeLien, setTradeLien] = useState("0");
  const [taxRate, setTaxRate] = useState("5");
  const [adminFee, setAdminFee] = useState("0");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [termStretch, setTermStretch] = useState(0);
  const [showAllDP, setShowAllDP] = useState(false);

  const isUserOwner = !!meData?.isOwner;

  const programs: LenderProgram[] = programsData?.programs ?? [];

  const selectedLenderObj = useMemo(
    () => programs.find(p => p.lenderCode === selectedLender),
    [programs, selectedLender],
  );

  const selectedGuide: LenderProgramGuide | undefined = useMemo(
    () => selectedLenderObj?.programs.find(g => g.programId === selectedProgram),
    [selectedLenderObj, selectedProgram],
  );

  const selectedTierObj: LenderProgramTier | undefined = useMemo(
    () => selectedGuide?.tiers.find(t => t.tierName === selectedTier),
    [selectedGuide, selectedTier],
  );

  const calcResults: LenderCalculateResponse | null = calcMutation.data ?? null;

  useEffect(() => {
    if (selectedLenderObj && selectedLenderObj.programs.length === 1 && !selectedProgram) {
      setSelectedProgram(selectedLenderObj.programs[0].programId);
    }
  }, [selectedLenderObj, selectedProgram]);

  useEffect(() => {
    if (selectedTierObj) {
      setApprovedRate(String(selectedTierObj.minRate));
    }
  }, [selectedTierObj]);

  useEffect(() => {
    if (!isUserOwner) return;
    let active = true;

    async function loadOpsStatus() {
      try {
        const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
        const candidates = Array.from(new Set([
          `${base}/api/ops/function-status`,
          "/api/ops/function-status",
          "api/ops/function-status",
        ]));

        let body: OpsFunctionStatusResponse | null = null;
        let lastStatus: number | null = null;

        for (const url of candidates) {
          const resp = await fetch(url, {
            credentials: "include",
            cache: "no-store",
          });
          if (resp.ok) {
            body = await resp.json() as OpsFunctionStatusResponse;
            break;
          }
          lastStatus = resp.status;
        }

        if (!body) {
          throw new Error(lastStatus === 404
            ? "HTTP 404 (ops route unavailable in current backend runtime)"
            : `HTTP ${lastStatus ?? "unknown"}`);
        }

        if (!active) return;
        setOpsStatus(body);
        setOpsError(null);
      } catch (err) {
        if (!active) return;
        setOpsError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void loadOpsStatus();
    const timer = setInterval(() => void loadOpsStatus(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isUserOwner]);

  const hasCalculated = useRef(false);
  const handleCalculateRef = useRef<() => void>(() => {});

  const handleRefresh = () => {
    refreshMutation.mutate(undefined, {
      onSuccess: () => {
        setTimeout(() => { refetchStatus(); refetchPrograms(); }, 2000);
      },
    });
  };

  const handleCalculate = useCallback(() => {
    if (!selectedLender || !selectedProgram || !selectedTier) return;
    const payload: any = {
      lenderCode: selectedLender,
      programId: selectedProgram,
      tierName: selectedTier,
      approvedRate: parseFloat(approvedRate) || 0,
      downPayment: parseFloat(downPayment) || 0,
      tradeValue: parseFloat(tradeValue) || 0,
      tradeLien: parseFloat(tradeLien) || 0,
      taxRate: parseFloat(taxRate) || 5,
      adminFee: parseFloat(adminFee) || 0,
      termStretchMonths: Number(termStretch) as 0 | 6 | 12,
    };
    const pmtOverride = parseFloat(maxPaymentOverride);
    if (pmtOverride > 0) payload.maxPaymentOverride = pmtOverride;
    hasCalculated.current = true;
    calcMutation.mutate({ data: payload });
  }, [selectedLender, selectedProgram, selectedTier, approvedRate, downPayment, tradeValue, tradeLien, taxRate, adminFee, termStretch, maxPaymentOverride, calcMutation]);

  handleCalculateRef.current = handleCalculate;

  useEffect(() => {
    if (!hasCalculated.current) return;
    handleCalculateRef.current();
  }, [termStretch]);

  const handleLenderChange = (code: string) => {
    setSelectedLender(code);
    setSelectedProgram("");
    setSelectedTier("");
  };

  const handleProgramChange = (programId: string) => {
    setSelectedProgram(programId);
    setSelectedTier("");
  };

  const totalPrograms = useMemo(
    () => programs.reduce((sum, p) => sum + p.programs.length, 0),
    [programs],
  );

  const selectClass = "h-9 text-sm font-medium bg-white border-gray-300 shadow-sm";
  const dropdownClass = "max-h-80 bg-white border border-gray-200 shadow-lg";
  const optionClass = "text-sm py-2.5 px-3 cursor-pointer hover:bg-gray-100 focus:bg-gray-100";

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Selector</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {programs.length} lender{programs.length !== 1 ? "s" : ""}, {totalPrograms} program{totalPrograms !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {statusData && (
            <div className="text-xs text-gray-400">
              {statusData.running ? (
                <span className="text-amber-600 font-medium flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Syncing...
                </span>
              ) : statusData.programsAge ? (
                <span>Updated {new Date(statusData.programsAge).toLocaleDateString()}</span>
              ) : (
                <span className="text-red-500">No data yet</span>
              )}
            </div>
          )}
          {isUserOwner && (
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshMutation.isPending || statusData?.running}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${statusData?.running ? "animate-spin" : ""}`} />
              Sync Programs
            </Button>
          )}
        </div>
      </div>

      {isUserOwner && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Ops Health</h2>
              {opsStatus && <span className="text-xs text-gray-500">Inventory: {opsStatus.inventoryCount}</span>}
            </div>

            {opsError && (
              <p className="text-xs text-red-600 mb-2">Unable to load ops status: {opsError}</p>
            )}

            {!opsStatus && !opsError && (
              <p className="text-xs text-gray-500">Loading operational checks...</p>
            )}

            {opsStatus && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Black Book &lt; 24h</span>
                    <OpsCheckBadge pass={opsStatus.checks.blackBookUpdatedWithin24Hours.pass} />
                  </div>
                  <p className="text-gray-500 mt-1">
                    Last run: {opsStatus.checks.blackBookUpdatedWithin24Hours.lastRunAt
                      ? new Date(opsStatus.checks.blackBookUpdatedWithin24Hours.lastRunAt).toLocaleString()
                      : "none"}
                  </p>
                </div>

                <div className="rounded border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Carfax Activity</span>
                    <OpsCheckBadge pass={opsStatus.checks.carfaxLookupActivity.pass} />
                  </div>
                  <p className="text-gray-500 mt-1">
                    Attempts: {opsStatus.checks.carfaxLookupActivity.attemptedCount} · Found: {opsStatus.checks.carfaxLookupActivity.foundUrlCount}
                  </p>
                </div>

                <div className="rounded border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Website Link Discovery</span>
                    <OpsCheckBadge pass={opsStatus.checks.websiteLinkDiscovery.pass} />
                  </div>
                  <p className="text-gray-500 mt-1">
                    Coverage: {opsStatus.checks.websiteLinkDiscovery.coveragePct}% · Found: {opsStatus.checks.websiteLinkDiscovery.foundUrlCount}
                  </p>
                </div>

                <div className="rounded border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Lender Programs Loaded</span>
                    <OpsCheckBadge pass={opsStatus.checks.lenderProgramsLoaded.pass} />
                  </div>
                  <p className="text-gray-500 mt-1">
                    Programs: {opsStatus.checks.lenderProgramsLoaded.lenderProgramCount}
                    {opsStatus.checks.lenderProgramsLoaded.updatedAt
                      ? ` · Updated ${new Date(opsStatus.checks.lenderProgramsLoaded.updatedAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {programs.length === 0 && !loadingPrograms && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">No lender programs cached</p>
                <p className="text-sm text-amber-700 mt-1">
                  {isUserOwner
                    ? 'Click "Sync Programs" to fetch the latest lender program matrices from CreditApp.'
                    : "No lender programs available. Ask an admin to sync programs."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {programs.length > 0 && (
        <>
          {/* Inputs — horizontal across top */}
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3">
                {/* Lender */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Lender</Label>
                  <Select value={selectedLender} onValueChange={handleLenderChange}>
                    <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className={dropdownClass}>
                      {programs.map(p => (
                        <SelectItem key={p.lenderCode} value={p.lenderCode} className={optionClass}>
                          {p.lenderName} ({p.lenderCode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Program */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Program</Label>
                  {selectedLenderObj && selectedLenderObj.programs.length === 1 && selectedProgram ? (
                    <div className="h-9 flex items-center px-3 bg-gray-50 border border-gray-200 rounded-md text-sm font-medium text-gray-700 truncate">
                      {selectedLenderObj.programs[0].programTitle}
                    </div>
                  ) : (
                    <Select value={selectedProgram} onValueChange={handleProgramChange} disabled={!selectedLenderObj}>
                      <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent className={dropdownClass}>
                        {(selectedLenderObj?.programs ?? []).map(g => (
                          <SelectItem key={g.programId} value={g.programId} className={optionClass}>
                            {g.programTitle} ({g.tiers.length} tier{g.tiers.length !== 1 ? "s" : ""})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Tier */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Tier</Label>
                  <Select value={selectedTier} onValueChange={setSelectedTier} disabled={!selectedGuide}>
                    <SelectTrigger className={selectClass}><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className={dropdownClass}>
                      {(selectedGuide?.tiers ?? []).map(t => (
                        <SelectItem key={t.tierName} value={t.tierName} className={optionClass}>
                          {t.tierName} ({t.minRate}–{t.maxRate}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Approved Rate */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Rate (%)</Label>
                  <Input type="number" step="0.01" value={approvedRate} onChange={e => setApprovedRate(e.target.value)} className="h-9" />
                </div>

                {/* Max Payment */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Max Payment</Label>
                  <Input
                    type="number" step="10"
                    placeholder={selectedTierObj ? `${selectedTierObj.maxPayment > 0 ? formatCurrency(selectedTierObj.maxPayment) : "None"}` : "Optional"}
                    value={maxPaymentOverride} onChange={e => setMaxPaymentOverride(e.target.value)} className="h-9"
                  />
                </div>

                {/* Down Payment */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Down Payment</Label>
                  <Input type="number" value={downPayment} onChange={e => setDownPayment(e.target.value)} className="h-9" />
                </div>
              </div>

              {/* Second row: trade, advanced toggle, View Inventory button */}
              <div className="flex items-end gap-4 mt-3">
                <div className="grid grid-cols-2 gap-3 w-64 flex-shrink-0">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Trade Value</Label>
                    <Input type="number" value={tradeValue} onChange={e => setTradeValue(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Trade Lien</Label>
                    <Input type="number" value={tradeLien} onChange={e => setTradeLien(e.target.value)} className="h-9" />
                  </div>
                </div>

                {showAdvanced && (
                  <div className="grid grid-cols-2 gap-3 w-56 flex-shrink-0">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Tax (%)</Label>
                      <Input type="number" step="0.5" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold tracking-wide text-gray-600 uppercase">Admin Fee</Label>
                      <Input type="number" value={adminFee} onChange={e => setAdminFee(e.target.value)} className="h-9" />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors pb-2 whitespace-nowrap"
                >
                  {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showAdvanced ? "Less" : "More"}
                </button>

                <div className="flex items-center gap-4 pb-1 ml-2">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="font-medium whitespace-nowrap">Term Exception:</span>
                    {[0, 6, 12].map(v => (
                      <label key={v} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio" name="termStretch" value={v}
                          checked={termStretch === v}
                          onChange={() => setTermStretch(v)}
                          className="w-3 h-3"
                        />
                        <span>{v === 0 ? "None" : `+${v}mo`}</span>
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox" checked={showAllDP}
                      onChange={e => setShowAllDP(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span className="font-medium">Show all + req. DP</span>
                  </label>
                </div>

                <div className="ml-auto flex-shrink-0">
                  <Button
                    onClick={handleCalculate}
                    disabled={!selectedLender || !selectedProgram || !selectedTier || calcMutation.isPending}
                    className="h-9"
                  >
                    {calcMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Eye className="w-4 h-4 mr-2" />
                    )}
                    View Inventory
                  </Button>
                </div>
              </div>

              {/* Tier info badge */}
              {selectedTierObj && (
                <div className="flex items-center gap-3 mt-2 text-xs text-blue-700">
                  <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200">
                    {selectedGuide?.programTitle} — {selectedTierObj.tierName}
                  </Badge>
                  <span>Rate: {selectedTierObj.minRate}–{selectedTierObj.maxRate}%</span>
                  <span>Max Pmt: {selectedTierObj.maxPayment > 0 ? formatCurrency(selectedTierObj.maxPayment) : "None"}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error */}
          {calcMutation.isError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Calculation Error</p>
                    <p className="text-sm text-red-700 mt-1">{String((calcMutation.error as any)?.message || "Unknown error")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results — full width below */}
          {calcResults && (
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Car className="w-4 h-4" />
                    Results
                    <Badge variant="secondary" className="text-xs ml-1">
                      {(() => {
                        const all = (calcResults.results ?? []) as any[];
                        const dpFree = all.filter(r => !((r.requiredDownPayment ?? 0) > 0)).length;
                        return showAllDP
                          ? `${all.length} vehicles`
                          : `${dpFree} of ${all.length} vehicles · zero down`;
                      })()}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-xs">{calcResults.lender} / {calcResults.program} / {calcResults.tier}</Badge>
                    <Badge variant="outline" className="text-xs">Rate: {approvedRate}%</Badge>
                    {maxPaymentOverride && Number(maxPaymentOverride) > 0 && (
                      <Badge variant="outline" className="text-xs">Pmt Cap: {formatCurrency(Number(maxPaymentOverride))}</Badge>
                    )}
                  </div>
                </div>

                {(() => {
                  const allResults = (calcResults.results ?? []) as any[];
                  const visibleResults = showAllDP
                    ? allResults
                    : allResults.filter(r => !((r.requiredDownPayment ?? 0) > 0));
                  const hiddenDpCount = allResults.length - visibleResults.length;

                  if (visibleResults.length === 0) {
                    return (
                      <div className="text-center py-12 text-gray-400">
                        <Car className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p className="text-sm font-medium">No vehicles qualify at zero down</p>
                        <p className="text-xs mt-1">
                          {hiddenDpCount > 0
                            ? `Toggle "Show all + req. DP" to see ${hiddenDpCount} vehicle${hiddenDpCount !== 1 ? "s" : ""} that need a down payment`
                            : "Try adjusting the max payment or rate"}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="rounded-md border border-gray-200 overflow-x-auto">
                      <table className="text-left w-full">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                          <tr className="border-b border-gray-200 text-[10px] text-gray-600 uppercase tracking-wide">
                            <th className="w-8 px-1.5 py-2 text-center">#</th>
                            <th className="px-2 py-2" style={{ minWidth: "220px" }}>Vehicle</th>
                            <th className="px-1.5 py-2 whitespace-nowrap">Loc</th>
                            <th className="px-1.5 py-2 text-center whitespace-nowrap">Term</th>
                            <th className="px-1.5 py-2 text-center whitespace-nowrap">Cond</th>
                            <th className="px-1.5 py-2 text-right whitespace-nowrap">BB Val</th>
                            <th className="px-2 py-2 text-right" style={{ minWidth: "100px" }}>Sell Price</th>
                            <th className="px-1.5 py-2 text-right whitespace-nowrap">Admin</th>
                            <th className="px-2 py-2 text-right" style={{ minWidth: "100px" }}>Warranty</th>
                            <th className="px-2 py-2 text-right" style={{ minWidth: "90px" }}>GAP</th>
                            <th className="px-2 py-2 text-right" style={{ minWidth: "90px" }}>Financed</th>
                            <th className="px-2 py-2 text-right whitespace-nowrap">Pmt</th>
                            <th className="px-2 py-2 text-right whitespace-nowrap" title="Total gross = front + admin + reserve + warranty profit + GAP profit">Total Gross</th>
                            {showAllDP && <th className="px-2 py-2 text-right whitespace-nowrap">Req. DP</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleResults.map((item: any, idx: number) => (
                            <ResultRow key={item.vin} item={item} rank={idx + 1} showDP={showAllDP} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {!calcResults && !calcMutation.isError && (
            <Card className="border-dashed border-gray-300">
              <CardContent className="py-16">
                <div className="text-center text-gray-400">
                  <Calculator className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">Select a lender, program, and tier, then click View Inventory</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
