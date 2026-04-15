import React, { useState, useMemo } from "react";
import {
  useGetLenderPrograms,
  useGetLenderStatus,
  useRefreshLender,
  useLenderCalculate,
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Calculator, DollarSign, Car, Percent, AlertCircle, ChevronDown, ChevronUp, Eye } from "lucide-react";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function formatPayment(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function TierConfigCard({ tier, programTitle }: { tier: LenderProgramTier; programTitle: string }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm space-y-2">
      <div className="font-medium text-blue-800">{programTitle} — {tier.tierName}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-blue-700">
        <div>Rate Range: <span className="font-semibold">{tier.minRate}–{tier.maxRate}%</span></div>
        <div>Max Payment: <span className="font-semibold">{tier.maxPayment > 0 ? formatCurrency(tier.maxPayment) : "None"}</span></div>
      </div>
    </div>
  );
}

function conditionLabel(c: string): string {
  const map: Record<string, string> = {
    extraClean: "Extra Clean",
    clean: "Clean",
    average: "Average",
    rough: "Rough",
  };
  return map[c] ?? c;
}

function ResultRow({ item, rank }: { item: LenderCalcResultItem; rank: number }) {
  return (
    <tr className="border-b border-gray-100 last:border-0 odd:bg-white even:bg-slate-50/40 hover:bg-blue-50/50">
      <td className="w-12 px-3 py-2.5 text-xs text-gray-500 font-semibold text-center">{rank}</td>
      <td className="w-[320px] px-3 py-2.5 text-sm font-semibold text-gray-900">
        <div className="truncate" title={item.vehicle}>{item.vehicle}</div>
      </td>
      <td className="w-28 px-3 py-2.5 text-sm text-gray-700">{item.location}</td>
      <td className="w-20 px-3 py-2.5 text-sm text-center text-gray-700">{item.term}mo</td>
      <td className="w-28 px-3 py-2.5 text-sm text-center">
        <Badge variant="outline" className="text-xs">{conditionLabel(item.conditionUsed)}</Badge>
      </td>
      <td className="w-28 px-3 py-2.5 text-sm text-right font-medium text-gray-700">{formatCurrency(item.bbWholesale)}</td>
      <td className="w-36 px-3 py-2.5 text-sm text-right font-medium text-gray-700">
        {item.sellingPrice > 0 ? formatCurrency(item.sellingPrice) : "—"}
        {item.priceSource && <span className="text-xs text-gray-400 ml-1">({item.priceSource === "online" ? "Online" : "PAC"})</span>}
      </td>
      <td className="w-36 px-3 py-2.5 text-sm text-right text-gray-700">
        {formatCurrency(item.warrantyPrice)}
        <span className="text-xs text-gray-400 ml-0.5">/{formatCurrency(item.warrantyCost)}</span>
      </td>
      <td className="w-32 px-3 py-2.5 text-sm text-right text-gray-700">
        {formatCurrency(item.gapPrice)}
        <span className="text-xs text-gray-400 ml-0.5">/{formatCurrency(item.gapCost)}</span>
      </td>
      <td className="w-36 px-3 py-2.5 text-sm text-right font-medium text-gray-700">{formatCurrency(item.totalFinanced)}</td>
      <td className="w-32 px-3 py-2.5 text-sm text-right font-semibold text-green-700">{formatPayment(item.monthlyPayment)}</td>
      <td className="w-32 px-3 py-2.5 text-sm text-right font-semibold text-emerald-700">{formatCurrency(item.profit)}</td>
    </tr>
  );
}

export default function LenderCalculator() {
  const { data: programsData, isLoading: loadingPrograms, refetch: refetchPrograms } = useGetLenderPrograms({
    query: { retry: false, refetchOnWindowFocus: false },
  });
  const { data: statusData, refetch: refetchStatus } = useGetLenderStatus({
    query: { retry: false, refetchInterval: 10_000 },
  });
  const refreshMutation = useRefreshLender();
  const calcMutation = useLenderCalculate();

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

  const handleRefresh = () => {
    refreshMutation.mutate(undefined as any, {
      onSuccess: () => {
        setTimeout(() => { refetchStatus(); refetchPrograms(); }, 2000);
      },
    });
  };

  const handleCalculate = () => {
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
    };
    const pmtOverride = parseFloat(maxPaymentOverride);
    if (pmtOverride > 0) payload.maxPaymentOverride = pmtOverride;

    calcMutation.mutate({ data: payload });
  };

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lender Deal Calculator</h1>
          <p className="text-sm text-gray-500 mt-1">
            Filter inventory by customer approval parameters using cached lender program matrices
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshMutation.isPending || statusData?.running}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${statusData?.running ? "animate-spin" : ""}`} />
            Sync Programs
          </Button>
        </div>
      </div>

      {programs.length === 0 && !loadingPrograms && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">No lender programs cached</p>
                <p className="text-sm text-amber-700 mt-1">
                  Click "Sync Programs" to fetch the latest lender program matrices from CreditApp.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {programs.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-[400px_minmax(0,1fr)] gap-6">
          <div>
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Calculator Inputs
                </CardTitle>
                <CardDescription>
                  {programs.length} lender{programs.length !== 1 ? "s" : ""}, {totalPrograms} program{totalPrograms !== 1 ? "s" : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase">Lender</Label>
                  <Select value={selectedLender} onValueChange={handleLenderChange}>
                    <SelectTrigger className="h-10 text-sm font-medium bg-white">
                      <SelectValue placeholder="Select a lender" />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {programs.map(p => (
                        <SelectItem key={p.lenderCode} value={p.lenderCode} className="text-sm py-2">
                          {p.lenderName} ({p.lenderCode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedLenderObj && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase">Program</Label>
                    <Select value={selectedProgram} onValueChange={handleProgramChange}>
                      <SelectTrigger className="h-10 text-sm font-medium bg-white">
                        <SelectValue placeholder="Select a program" />
                      </SelectTrigger>
                      <SelectContent className="max-h-80">
                        {selectedLenderObj.programs.map(g => (
                          <SelectItem key={g.programId} value={g.programId} className="text-sm py-2">
                            {g.programTitle} ({g.tiers.length} tier{g.tiers.length !== 1 ? "s" : ""})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedGuide && (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase">Tier</Label>
                    <Select value={selectedTier} onValueChange={setSelectedTier}>
                      <SelectTrigger className="h-10 text-sm font-medium bg-white">
                        <SelectValue placeholder="Select a tier" />
                      </SelectTrigger>
                      <SelectContent className="max-h-80">
                        {selectedGuide.tiers.map(t => (
                          <SelectItem key={t.tierName} value={t.tierName} className="text-sm py-2">
                            {t.tierName} ({t.minRate}–{t.maxRate}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedTierObj && selectedGuide && (
                  <TierConfigCard tier={selectedTierObj} programTitle={selectedGuide.programTitle} />
                )}

                <Separator />

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase flex items-center gap-1">
                    <Percent className="w-3 h-3" /> Rate (%)
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={approvedRate}
                    onChange={e => setApprovedRate(e.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Max Payment Override
                  </Label>
                  <Input
                    type="number"
                    step="10"
                    placeholder={selectedTierObj ? `Tier max: ${selectedTierObj.maxPayment > 0 ? formatCurrency(selectedTierObj.maxPayment) : "None"}` : "Optional"}
                    value={maxPaymentOverride}
                    onChange={e => setMaxPaymentOverride(e.target.value)}
                    className="h-9"
                  />
                </div>

                <Separator />

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase">Down Payment</Label>
                  <Input
                    type="number"
                    value={downPayment}
                    onChange={e => setDownPayment(e.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase">Trade-In Value</Label>
                    <Input
                      type="number"
                      value={tradeValue}
                      onChange={e => setTradeValue(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase">Trade Lien</Label>
                    <Input
                      type="number"
                      value={tradeLien}
                      onChange={e => setTradeLien(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showAdvanced ? "Hide" : "Show"} advanced options
                </button>

                {showAdvanced && (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase">Tax Rate (%)</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={taxRate}
                          onChange={e => setTaxRate(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold tracking-wide text-gray-700 uppercase">Dealer Admin Fee</Label>
                        <Input
                          type="number"
                          value={adminFee}
                          onChange={e => setAdminFee(e.target.value)}
                          className="h-9"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">
                      Warranty &amp; GAP are auto-optimized per vehicle (150% markup = cost × 2.5, min $600/$550 cost) to maximize profit within LTV limits.
                      {selectedGuide?.maxWarrantyPrice != null && <span className="block mt-1">Max warranty selling price: {formatCurrency(selectedGuide.maxWarrantyPrice)}</span>}
                      {selectedGuide?.maxGapPrice != null && selectedGuide.maxGapPrice === 0 && <span className="block mt-1 text-amber-600 font-medium">GAP not allowed by this lender</span>}
                      {selectedGuide?.maxGapPrice != null && selectedGuide.maxGapPrice > 0 && <span className="block mt-1">Max GAP selling price: {formatCurrency(selectedGuide.maxGapPrice)}</span>}
                      {selectedGuide?.maxAdminFee != null && <span className="block mt-1">Max admin fee: {formatCurrency(selectedGuide.maxAdminFee)}</span>}
                    </p>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleCalculate}
                  disabled={!selectedLender || !selectedProgram || !selectedTier || calcMutation.isPending}
                >
                  {calcMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4 mr-2" />
                  )}
                  View Inventory
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="min-w-0">
            {calcMutation.isError && (
              <Card className="border-red-200 bg-red-50 mb-4">
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

            {calcResults && (
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Car className="w-4 h-4" />
                      Results
                      <Badge variant="secondary" className="text-xs ml-1">{calcResults.resultCount} vehicles</Badge>
                    </CardTitle>
                    <div className="text-xs text-gray-500 text-right">
                      {calcResults.lender} / {calcResults.program} / {calcResults.tier}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge variant="outline" className="text-xs">Rate: {approvedRate}%</Badge>
                    <Badge variant="outline" className="text-xs">Tax: {taxRate}%</Badge>
                    {maxPaymentOverride && Number(maxPaymentOverride) > 0 && (
                      <Badge variant="outline" className="text-xs">Pmt Cap: {formatCurrency(Number(maxPaymentOverride))}</Badge>
                    )}
                    <Badge variant="outline" className="text-xs">Down: {formatCurrency(Number(downPayment || 0))}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {calcResults.resultCount === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <Car className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-sm font-medium">No vehicles qualify</p>
                      <p className="text-xs mt-1">Try adjusting the max payment or rate</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-gray-200">
                      <table className="text-left min-w-[1520px] w-full table-fixed">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                          <tr className="border-b border-gray-200 text-xs text-gray-600 uppercase tracking-wide">
                            <th className="w-12 px-3 py-2 text-center">#</th>
                            <th className="w-[320px] px-3 py-2">Vehicle</th>
                            <th className="w-28 px-3 py-2">Location</th>
                            <th className="w-20 px-3 py-2 text-center">Term</th>
                            <th className="w-28 px-3 py-2 text-center">Condition</th>
                            <th className="w-28 px-3 py-2 text-right">BB Value</th>
                            <th className="w-36 px-3 py-2 text-right">Sell Price</th>
                            <th className="w-36 px-3 py-2 text-right">Warranty</th>
                            <th className="w-32 px-3 py-2 text-right">GAP</th>
                            <th className="w-36 px-3 py-2 text-right">Financed</th>
                            <th className="w-32 px-3 py-2 text-right">Payment</th>
                            <th className="w-32 px-3 py-2 text-right">Profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calcResults.results.map((item, idx) => (
                            <ResultRow key={item.vin} item={item} rank={idx + 1} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {!calcResults && !calcMutation.isError && (
              <Card className="border-dashed border-gray-300">
                <CardContent className="py-16">
                  <div className="text-center text-gray-400">
                    <Calculator className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">Select a lender, program, and tier, then click View Inventory</p>
                    <p className="text-xs mt-1">
                      The calculator will filter your inventory by the customer's approval parameters
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
