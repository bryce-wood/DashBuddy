const DEFAULT_CAR_DATA = {
    id: 1, 
    nickname: "Default Vehicle",
    fuelType: "gas",
    efficiency: 20, // 20 MPG
    depreciationCostPerMile: 0.35,
    maintenanceCostPerMile: 0.10,
    repairCostPerMile: 0.05
};

class Car {
    constructor({ 
        id = DEFAULT_CAR_DATA.id, 
        nickname = DEFAULT_CAR_DATA.nickname, 
        fuelType = DEFAULT_CAR_DATA.fuelType, 
        efficiency = DEFAULT_CAR_DATA.efficiency,
        depreciationCostPerMile = DEFAULT_CAR_DATA.depreciationCostPerMile,
        maintenanceCostPerMile = DEFAULT_CAR_DATA.maintenanceCostPerMile,
        repairCostPerMile = DEFAULT_CAR_DATA.repairCostPerMile
    }) {
        this.id = id;
        this.nickname = nickname;
        this.fuelType = fuelType;
        this.efficiency = efficiency; 
        this.depreciationCostPerMile = depreciationCostPerMile;
        this.maintenanceCostPerMile = maintenanceCostPerMile;
        this.repairCostPerMile = repairCostPerMile;
    }

    // Static helper to quickly grab a default instance
    static createDefault() {
        return new Car(DEFAULT_CAR_DATA);
    }

    // Calculates how much energy/fuel was used for a distance
    calculateFuelUsed(miles) {
        return miles / this.efficiency;
    }
    
    // Standardized wear and tear for this specific car
    getOperatingCostPerMile() {
        const depreciation = Number.isFinite(this.depreciationCostPerMile) ? this.depreciationCostPerMile : 0;
        const maintenance = Number.isFinite(this.maintenanceCostPerMile) ? this.maintenanceCostPerMile : 0;
        const repair = Number.isFinite(this.repairCostPerMile) ? this.repairCostPerMile : 0;
        return depreciation + maintenance + repair;
    }
}

export { Car };