const MILAGE_RATE = 0.725; // IRS standard mileage deduction for 2026

class Shift {
  constructor({
    startTime,
    startOdometer,
    carRef,
    fuelPriceAtStart,
    endTime = null,
    endOdometer = null,
    grossPay = 0,
    percentTips = 0.5, // Approximate percentage of income that is from tips (and thus not taxed)
  }) {
    this.startTime = new Date(startTime);
    this.endTime = endTime ? new Date(endTime) : null;
    this.startOdometer = Number(startOdometer);
    this.endOdometer = endOdometer != null ? Number(endOdometer) : null;
    this.grossPay = Number(grossPay) || 0;
    this.carRef = carRef;
    this.fuelPrice = Number(fuelPriceAtStart) || 4.0; // Capture the market price NOW
    const tipValue = Number(percentTips);
    this.percentTips = Number.isFinite(tipValue) ? tipValue : 0.5;
  }

  get milesDriven() {
    if (Number.isFinite(this.startOdometer) && Number.isFinite(this.endOdometer)) {
      return this.endOdometer - this.startOdometer;
    }
    return -1; // -1 indicates incomplete data
  }

  get hoursTaken() {
    if (!this.endTime) return 0;
    const msDiff = this.endTime - this.startTime;
    // 1 minute = 1 hour for testing purposes, so we return minutes instead of hours
    return (msDiff / (1000 * 60));
  }

  get averageSpeed() {
    return this.hoursTaken > 0 ? this.milesDriven / this.hoursTaken : 0;
  }

  get hourlyGrossPay() {
    return this.hoursTaken > 0 ? this.grossPay / this.hoursTaken : 0;
  }

  get perMileGrossPay() {
    return this.milesDriven > 0 ? this.grossPay / this.milesDriven : 0;
  }

  get fuelCost() {
    const miles = Math.max(0, this.milesDriven);
    const unitsUsed = this.carRef?.calculateFuelUsed?.(miles) ?? 0;
    const price = Number.isFinite(this.fuelPrice) ? this.fuelPrice : 0;
    return unitsUsed * price; // fuelPrice is $/gal or $/kWh
  }

  get depreciationCost() {
    const miles = Math.max(0, this.milesDriven);
    const perMileDepreciation = Number(this.carRef?.depreciationCostPerMile ?? 0);
    return miles * (Number.isFinite(perMileDepreciation) ? perMileDepreciation : 0);
  }

  get maintenanceCost() {
    const miles = Math.max(0, this.milesDriven);
    const perMileMaintenance = Number(this.carRef?.maintenanceCostPerMile ?? 0);
    return miles * (Number.isFinite(perMileMaintenance) ? perMileMaintenance : 0);
  }

  get repairCost() {
    const miles = Math.max(0, this.milesDriven);
    const perMileRepair = Number(this.carRef?.repairCostPerMile ?? 0);
    return miles * (Number.isFinite(perMileRepair) ? perMileRepair : 0);
  }

  get wearAndTearCost() {
    return this.depreciationCost + this.maintenanceCost + this.repairCost;
  }

  get taxCost() {
    const miles = Math.max(0, this.milesDriven);
    const deductible = miles * MILAGE_RATE; // IRS standard mileage deduction for 2026
    const taxableIncome = Math.max(0, Math.max(this.grossPay * (1 - this.percentTips), this.grossPay - 25000) - deductible); // max $25k of tips untaxxed
    const selfEmploymentTax = taxableIncome * 0.9235 * 0.153; // 15.3% Self-Employment tax on 92.35% of profit above $600
    const incomeTax = taxableIncome * 0.10; // Flat 10% income tax for simplicity (need annual income for accurate taxes)
    /*
    // US Federal Income Tax Brackets for Single Filers in 2026
    if (taxableIncome > 626_350) {
        incomeTax += (taxableIncome - 626_350) * 0.37;
        taxableIncome = 626_350;
    }
    if (taxableIncome > 250_525) {
        incomeTax += (taxableIncome - 250_525) * 0.35;
        taxableIncome = 250_525;
    }
    if (taxableIncome > 197_300) {
        incomeTax += (taxableIncome - 197_300) * 0.32;
        taxableIncome = 197_300;
    }
    if (taxableIncome > 103_350) {
        incomeTax += (taxableIncome - 103_350) * 0.24;
        taxableIncome = 103_350;
    }
    if (taxableIncome > 48_475) {
        incomeTax += (taxableIncome - 48_475) * 0.22;
        taxableIncome = 48_475;
    }
    if (taxableIncome > 11_925) {
        incomeTax += (taxableIncome - 11_925) * 0.12;
        taxableIncome = 11_925;
    }
        
    incomeTax += taxableIncome * 0.10; */
    return incomeTax + selfEmploymentTax;
  }

  get netPay() {
    const gross = Number.isFinite(this.grossPay) ? this.grossPay : 0;
    return gross - this.fuelCost - this.wearAndTearCost - this.taxCost;
  }

  get hourlyNetPay() {
    return this.hoursTaken > 0 ? this.netPay / this.hoursTaken : 0;
  }

  // Helper to turn this into the JSON format for your DB
  toJSON() {
    return {
      startTime: this.startTime.toUTCString(),
      endTime: this.endTime?.toUTCString(),
      startOdometer: this.startOdometer,
      endOdometer: this.endOdometer,
      grossPay: this.grossPay,
      carId: this.carRef?.id,
      fuelPrice: this.fuelPrice,
      percentTips: this.percentTips,
    };
  }

  toDocument() {
    return {
      startTime: this.startTime,
      endTime: this.endTime,
      startOdometer: this.startOdometer,
      endOdometer: this.endOdometer,
      grossPay: this.grossPay,
      carId: this.carRef?.id,
      fuelPrice: this.fuelPrice,
      percentTips: this.percentTips,
      milesDriven: this.milesDriven,
      hoursTaken: this.hoursTaken,
      averageSpeed: this.averageSpeed,
      fuelCost: this.fuelCost,
      depreciationCost: this.depreciationCost,
      maintenanceCost: this.maintenanceCost,
      repairCost: this.repairCost,
      wearAndTearCost: this.wearAndTearCost,
      taxCost: this.taxCost,
      netPay: this.netPay,
      hourlyGrossPay: this.hourlyGrossPay,
      hourlyNetPay: this.hourlyNetPay,
    };
  }
}

export { Shift };
