import React, { useState, useMemo } from "react";
import {
  useGetLenderPrograms,
  useGetLenderStatus,
  useRefreshLender,
  useLenderCalculate,
} from "@workspace/api-client-react";
import type {
  LenderProgram,
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
import { RefreshCw, Calculator, DollarSign, Car, Percent, Clock, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function formatPayment(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function TierConfigCard({ tier }: { tier: LenderProgramTier }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm space-y-2">
      <div className="font-medium text-blue-800">Tier: {tier.tierName}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-blue-700">
        <div>Max Advance LTV: <span className="font-semibold">{tier.maxAdvanceLTV}%</span></div>
        <div>Max Aftermarket LTV: <span className="font-semibold">{tier.maxAftermarketLTV}%</span></div>
        <div>Max All-In LTV: <span className="font-semibold">{tier.maxAllInLTV}%</span></div>
        <div>Creditor Fee: <span className="font-semibold">{formatCurrency(tier.creditorFee)}</span></div>
        <div>Dealer Reserve: <span className="font-semibold">{tier.dealerReserve}%</span></div>
        {tier.minRate != null && <div>Rate Range: <span className="font-semibold">{tier.minRate}–{tier.maxRate}%</span></div>}
        {tier.minTerm != null && <div>Term Range: <span className="font-semibold">{tier.minTerm}–{tier.maxTerm} mo</span></div>}
      </div>
    </div>
  );
}

function ResultRow({ item, rank }: { item: LenderCalcResultItem; rank: number }) {
  return (
    <tr className="hover:bg-gray-50 border-b border-gray-100 last:border-0">
      <td className="px-3 py-2.5 text-sm text-gray-500 font-medium">{rank}</td>
      <td className="px-3 py-2.5">
        <div className="text-sm font-medium text-gray-900">{item.vehicle}</div>
        <div className="text-xs text-gray-400 font-mono">{item.vin}</div>
      </td>
      <td className="px-3 py-2.5 text-sm text-gray-600">{item.location}</td>
      <td className="px-3 py-2.5 text-sm text-right font-medium text-gray-700">{formatCurrency(item.bbWholesale)}</td>
      <td className="px-3 py-2.5 text-sm text-right font-medium text-gray-700">{formatCurrency(item.maxAdvance)}</td>
      <td className="px-3 py-2.5 text-sm text-right font-medium text-gray-700">{formatCurrency(item.totalFinanced)}</td>
      <td className="px-3 py-2.5 text-sm text-right font-semibold text-green-700">{formatPayment(item.monthlyPayment)}</td>
      <td className="px-3 py-2.5 text-sm text-right text-gray-500">{formatCurrency(item.costOfBorrowing)}</td>
      <td className="px-3 py-2.5 text-sm text-right">
        <Badge variant={item.ltv > 130 ? "destructive" : item.ltv > 110 ? "secondary" : "default"} className="text-xs">
          {item.ltv}%
        </Badge>
      </td>
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
  const [selectedTier, setSelectedTier] = useState("");
  const [approvedRate, setApprovedRate] = useState("14.99");
  const [approvedTerm, setApprovedTerm] = useState("72");
  const [maxPayment, setMaxPayment] = useState("500");
  const [downPayment, setDownPayment] = useState("0");
  const [tradeValue, setTradeValue] = useState("0");
  const [tradeLien, setTradeLien] = useState("0");
  const [taxRate, setTaxRate] = useState("5");
  const [aftermarketAmount, setAftermarketAmount] = useState("0");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const programs: LenderProgram[] = programsData?.programs ?? [];

  const selectedLenderObj = useMemo(
    () => programs.find(p => p.lenderCode === selectedLender),
    [programs, selectedLender],
  );

  const selectedTierObj = useMemo(
    () => selectedLenderObj?.tiers.find(t => t.tierName === selectedTier),
    [selectedLenderObj, selectedTier],
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
    if (!selectedLender || !selectedTier) return;
    calcMutation.mutate({
      data: {
        lenderCode: selectedLender,
        tierName: selectedTier,
        approvedRate: parseFloat(approvedRate) || 0,
        approvedTerm: parseInt(approvedTerm) || 72,
        maxPayment: parseFloat(maxPayment) || 500,
        downPayment: parseFloat(downPayment) || 0,
        tradeValue: parseFloat(tradeValue) || 0,
        tradeLien: parseFloat(tradeLien) || 0,
        taxRate: parseFloat(taxRate) || 5,
        includeAftermarket: parseFloat(aftermarketAmount) > 0,
        aftermarketAmount: parseFloat(aftermarketAmount) || 0,
      },
    });
  };

  const handleLenderChange = (code: string) => {
    setSelectedLender(code);
    setSelectedTier("");
  };

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
                  This requires a recent deal submitted to lenders in the system.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {programs.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="w-4 h-4" />
                  Calculator Inputs
                </CardTitle>
                <CardDescription>Select lender, tier, and enter approval details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-gray-600">Lender</Label>
                  <Select value={selectedLender} onValueChange={handleLenderChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a lender" />
                    </SelectTrigger>
                    <SelectContent>
                      {programs.map(p => (
                        <SelectItem key={p.lenderCode} value={p.lenderCode}>
                          {p.lenderName} ({p.lenderCode}) — {p.tiers.length} tier{p.tiers.length !== 1 ? "s" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedLenderObj && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-600">Program Tier</Label>
                    <Select value={selectedTier} onValueChange={setSelectedTier}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a tier" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedLenderObj.tiers.map(t => (
                          <SelectItem key={t.tierName} value={t.tierName}>
                            {t.tierName} (LTV {t.maxAdvanceLTV}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedTierObj && <TierConfigCard tier={selectedTierObj} />}

                <Separator />

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-gray-600 flex items-center gap-1">
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
                    <Label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Term (mo)
                    </Label>
                    <Input
                      type="number"
                      value={approvedTerm}
                      onChange={e => setApprovedTerm(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Max Monthly Payment
                  </Label>
                  <Input
                    type="number"
                    step="10"
                    value={maxPayment}
                    onChange={e => setMaxPayment(e.target.value)}
                    className="h-9"
                  />
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
                        <Label className="text-xs font-medium text-gray-600">Down Payment</Label>
                        <Input
                          type="number"
                          value={downPayment}
                          onChange={e => setDownPayment(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-gray-600">Tax Rate (%)</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={taxRate}
                          onChange={e => setTaxRate(e.target.value)}
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-gray-600">Trade Value</Label>
                        <Input
                          type="number"
                          value={tradeValue}
                          onChange={e => setTradeValue(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-gray-600">Trade Lien</Label>
                        <Input
                          type="number"
                          value={tradeLien}
                          onChange={e => setTradeLien(e.target.value)}
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-gray-600">Aftermarket ($)</Label>
                      <Input
                        type="number"
                        value={aftermarketAmount}
                        onChange={e => setAftermarketAmount(e.target.value)}
                        className="h-9"
                      />
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={handleCalculate}
                  disabled={!selectedLender || !selectedTier || calcMutation.isPending}
                >
                  {calcMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Calculator className="w-4 h-4 mr-2" />
                  )}
                  Calculate
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
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
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Car className="w-4 h-4" />
                      Results
                      <Badge variant="secondary" className="text-xs ml-1">{calcResults.resultCount} vehicles</Badge>
                    </CardTitle>
                    <div className="text-xs text-gray-400">
                      {calcResults.lender} / {calcResults.tier}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {calcResults.resultCount === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <Car className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-sm font-medium">No vehicles qualify</p>
                      <p className="text-xs mt-1">Try adjusting the max payment, rate, or term</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto -mx-6">
                      <table className="w-full text-left min-w-[700px]">
                        <thead>
                          <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wider">
                            <th className="px-3 py-2">#</th>
                            <th className="px-3 py-2">Vehicle</th>
                            <th className="px-3 py-2">Location</th>
                            <th className="px-3 py-2 text-right">BB Wholesale</th>
                            <th className="px-3 py-2 text-right">Max Advance</th>
                            <th className="px-3 py-2 text-right">Financed</th>
                            <th className="px-3 py-2 text-right">Payment</th>
                            <th className="px-3 py-2 text-right">COB</th>
                            <th className="px-3 py-2 text-right">LTV</th>
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
                    <p className="text-sm font-medium">Select a lender and tier, then click Calculate</p>
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
