import { Client, EmbedBuilder, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import "dotenv/config";
import { Shift } from "./shift.js";
import { Car } from "./car.js";

const ephemeralFlag = 1 << 6; // This flag makes the bot's response visible only to the user who invoked the command

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages, // Needed to receive DMs
    GatewayIntentBits.MessageContent, // Needed to read the text in the DM
  ],
  // DMs often don't contain full data when they first arrive, so the bot needs to be able to handle "partial" data.
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

const activeShifts = new Map();
const pendingShiftSyncs = [];
const completedShiftHistory = [];
const shiftHistorySessions = new Map();
const userCars = new Map();
const defaultCar = Car.createDefault();

function getUserCars(userId) {
  return userCars.get(userId) ?? [];
}

function saveUserCars(userId, cars) {
  userCars.set(userId, cars);
}

function getNextCarId(userId) {
  return getUserCars(userId).reduce((maxId, car) => Math.max(maxId, car.id), 0) + 1;
}

function findUserCar(userId, carId) {
  return getUserCars(userId).find((car) => car.id === carId);
}

function buildCarListEmbed(cars) {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("🚘 Your Saved Cars")
    .setDescription("Use /startshift with carid to select one of your custom cars. If you omit carid, the default car is used.");

  cars.forEach((car) => {
    embed.addFields({
      name: `ID ${car.id}: ${car.nickname}`,
      value: `Fuel Type: ${car.fuelType}
Efficiency: ${car.efficiency}
Depreciation: $${car.depreciationCostPerMile}/mi
Maintenance: $${car.maintenanceCostPerMile}/mi
Repair: $${car.repairCostPerMile}/mi`,
      inline: false,
    });
  });

  return embed;
}

function buildShiftSummaryEmbed(shift, index, total) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📊 Shift Summary ${index + 1} / ${total}`)
    .setDescription("Great work! Your shift details have been calculated below.")
    .setTimestamp()
    .addFields(
      {
        name: "💰 Earnings",
        value: `**Gross Pay:** $${shift.grossPay.toFixed(2)}\n**Rate:** $${shift.hourlyGrossPay.toFixed(2)}/hour\n**Per Mile:** $${shift.perMileGrossPay.toFixed(2)}/mile`,
        inline: true,
      },
      {
        name: "🚗 Travel",
        value: `**Avg Speed:** ${shift.averageSpeed.toFixed(2)} mph\n**Distance:** ${shift.milesDriven.toLocaleString()} mi\n**Odometer:** ${shift.startOdometer.toLocaleString()} → ${shift.endOdometer.toLocaleString()} mi`,
        inline: true,
      },
      {
        name: "🕒 Timing",
        value: `**Duration:** ${shift.hoursTaken.toFixed(2)} hours\n**Started:** <t:${Math.floor(shift.startTime / 1000)}:F>\n**Ended:** <t:${Math.floor(shift.endTime / 1000)}:F>`,
        inline: false,
      },
      {
        name: "📉 *Estimated Expenses",
        value: `**Fuel:** $${shift.fuelCost.toFixed(2)}\n**Wear & Tear:** $${shift.wearAndTearCost.toFixed(2)}\n**Taxes:** $${shift.taxCost.toFixed(2)}\n*(Tip %: ${Math.round(shift.percentTips * 100)}%)*`,
        inline: false,
      },
      {
        name: "💸 *Estimated Final Take-Home",
        value: `**Net Pay:** $${shift.netPay.toFixed(2)}\n**Net Rate:** $${shift.hourlyNetPay.toFixed(2)}/hr`,
        inline: false,
      },
    );
}

function buildHistoryButtons(currentIndex, total) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shifthistory_prev`)
      .setLabel("⬅️ Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentIndex <= 0),
    new ButtonBuilder()
      .setCustomId(`shifthistory_next`)
      .setLabel("Next ➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentIndex >= total - 1),
  );
}

function buildShiftTotalsEmbed(stats) {
  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("📈 Lifetime Shift Summary")
    .setDescription("Aggregated statistics from your stored shifts.")
    .addFields(
      {
        name: "💰 Gross Pay",
        value: `**Total:** $${stats.totalGrossPay.toFixed(2)}\n**Avg Hourly:** $${stats.averageHourlyGross.toFixed(2)}/hr`,
        inline: false,
      },
      {
        name: "💵 Estimated Net Pay",
        value: `**Total:** $${stats.totalNetPay.toFixed(2)}\n**Avg Hourly:** $${stats.averageHourlyNet.toFixed(2)}/hr`,
        inline: false,
      },
      {
        name: "⛽ Estimated Fuel Cost",
        value: `$${stats.totalFuelCost.toFixed(2)}`,
        inline: true,
      },
      {
        name: "🛠️ Estimated Wear & Tear",
        value: `$${stats.totalWearAndTear.toFixed(2)}`,
        inline: true,
      },
      {
        name: "📉 Estimated Taxes",
        value: `$${stats.totalTaxCost.toFixed(2)}`,
        inline: true,
      },
      {
        name: "🕒 Time & Distance",
        value: `**Total Hours:** ${stats.totalHours.toFixed(2)}\n**Total Miles:** ${stats.totalMiles.toLocaleString()} mi\n**Avg Speed:** ${stats.averageSpeed.toFixed(2)} mph`,
        inline: false,
      },
    );
}

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
  // register slash commands
  const commands = await client.application.commands.set([
    {
      name: "time",
      description: "Gives the current local time.",
    },
    {
      name: "ping",
      description: 'Replies "Pong!" with the bot\'s latency.',
    },
    {
        name: "server",
        description: "Replies with the DashBuddy Discord server invite link.",
    },
    {
      name: "startshift",
      description: "Starts a new shift.",
      options: [
        {
          name: "odometer",
          type: 10, // NUMBER
          description:
            "IMPORTANT: this should be the full odometer reading and it should be accurate.",
          required: true,
        },
        {
          name: "fuelprice",
          type: 10, // NUMBER
          description: "Optional fuel price per gallon/kWh at shift start. Defaults to $4.00.",
          required: false,
        },
        {
          name: "carid",
          type: 10, // NUMBER
          description: "Optional car ID from your saved cars. Defaults to default vehicle if omitted.",
          required: false,
        },
      ],
    },
    {
      name: "createcar",
      description: "Create a custom car that can be selected for future shifts.",
      options: [
        {
          name: "nickname",
          type: 3, // STRING
          description: "A memorable name for your car.",
          required: true,
        },
        {
          name: "fueltype",
          type: 3, // STRING
          description: "Fuel type, like gas or electric.",
          required: true,
        },
        {
          name: "efficiency",
          type: 10, // NUMBER
          description: "Fuel efficiency in miles per gallon or miles per kWh.",
          required: true,
        },
        {
          name: "depreciationcostpermile",
          type: 10, // NUMBER
          description: "Depreciation cost per mile.",
          required: true,
        },
        {
          name: "maintenancecostpermile",
          type: 10, // NUMBER
          description: "Maintenance cost per mile.",
          required: true,
        },
        {
          name: "repaircostpermile",
          type: 10, // NUMBER
          description: "Repair cost per mile.",
          required: true,
        },
      ],
    },
    {
      name: "listcars",
      description: "List your saved custom cars.",
    },
    {
      name: "endshift",
      description: "Ends the current shift.",
      options: [
        {
          name: "odometer",
          type: 10, // NUMBER
          description:
            "IMPORTANT: this should be the full odometer reading and it should be accurate.",
          required: true,
        },
        {
          name: "grosspay",
          type: 10, // NUMBER
          description: "How much money you made in the form x.xx",
          required: true,
        },
        {
          name: "tippercent",
          type: 10, // NUMBER
          description: "Optional % of gross pay that came from tips, as a decimal (default 0.5 = 50%). Used in income tax.",
          required: false,
        },
      ],
    },
    {
      name: "shifthistory",
      description: "Shows your shift history.",
    },
    {
      name: "shiftssummary",
      description: "Shows aggregate totals and averages for your stored shifts.",
    },
  ]);
  console.log(
    `Registered ${commands.size} commands:`,
    commands.map((c) => c.name).join(", "),
  );
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("shifthistory_")) {
    const session = shiftHistorySessions.get(interaction.message.id);
    if (!session) {
      await interaction.reply({
        content: "This shift history session has expired. Please run /shifthistory again.",
        flags: ephemeralFlag,
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content: "Only the user who opened this history can navigate it.",
        flags: ephemeralFlag,
      });
      return;
    }

    const total = session.shifts.length;
    let nextIndex = session.currentIndex;
    if (interaction.customId === "shifthistory_prev") {
      nextIndex = Math.max(0, nextIndex - 1);
    }
    if (interaction.customId === "shifthistory_next") {
      nextIndex = Math.min(total - 1, nextIndex + 1);
    }

    session.currentIndex = nextIndex;
    shiftHistorySessions.set(interaction.message.id, session);

    await interaction.update({
      embeds: [buildShiftSummaryEmbed(session.shifts[nextIndex].shift, nextIndex, total)],
      components: [buildHistoryButtons(nextIndex, total)],
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const localNow = `<t:${Math.floor(Date.now() / 1000)}:F>`; // Discord's timestamp format for local time (works across timezones)
  switch (interaction.commandName) {
    case "time": {
      await interaction.reply(`${localNow}`);
      break;
    }
    case "ping": {
      await interaction.reply(`Pong! Latency is ${client.ws.ping}ms.`);
      break;
    }
    case "server": {
      await interaction.reply("https://discord.gg/VTzmnJTjtZ");
      break;
    }
    case "startshift": {
      const odometer = interaction.options.getNumber("odometer", true);
      const fuelPrice = interaction.options.getNumber("fuelprice") ?? 4.0;
      const carId = interaction.options.getNumber("carid", false);
      let selectedCar = defaultCar;
      let selectedCarLabel = defaultCar.nickname;

      if (carId !== null) {
        if (!Number.isInteger(carId) || carId <= 0) {
          await interaction.reply({
            content: "carid must be a positive integer representing one of your saved cars.",
            flags: ephemeralFlag,
          });
          return;
        }

        const customCar = findUserCar(interaction.user.id, carId);
        if (!customCar) {
          await interaction.reply({
            content: `No saved car found with ID ${carId}. Use /listcars to see your saved cars.`,
            flags: ephemeralFlag,
          });
          return;
        }

        selectedCar = customCar;
        selectedCarLabel = `${customCar.nickname} (ID ${customCar.id})`;
      }

      if (odometer < 0) {
        await interaction.reply({
          content: "Odometer must be zero or a positive number.",
          flags: ephemeralFlag,
        });
        return;
      }

      if (fuelPrice <= 0) {
        await interaction.reply({
          content: "Fuel price must be a positive number.",
          flags: ephemeralFlag,
        });
        return;
      }

      const existing = activeShifts.get(interaction.user.id);
      if (existing) {
        const startDate = `<t:${Math.floor(new Date(existing.startTimestamp) / 1000)}:F>`;
        await interaction.reply({
          content: `You already have an active shift started at odometer ${existing.odometer} on ${startDate}. Use /endshift to finish it before starting a new one.`,
          flags: ephemeralFlag,
        });
        return;
      }

      activeShifts.set(interaction.user.id, {
        odometer,
        startTimestamp: Date.now(),
        carRef: selectedCar,
        fuelPriceAtStart: fuelPrice,
      });

      const shiftStartEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🚀 Shift Started")
        .setDescription("Your shift is now being tracked. Drive safe!")
        .addFields(
          { name: "⏲️ Start Time", value: `${localNow}`, inline: true },
          { name: "🛣️ Odometer", value: `${odometer.toLocaleString()} mi`, inline: true },
          { name: "⛽ Fuel Price", value: `$${fuelPrice.toFixed(2)}`, inline: true },
          { name: "🚘 Car", value: `${selectedCarLabel}`, inline: true },
        )
        .setFooter({
          text: "NOTE: for testing minutes count as hours (5 minutes = 5 hours).",
        })
        .setTimestamp();

      await interaction.reply({
        embeds: [shiftStartEmbed],
      });
      break;
    }
    case "endshift": {
      const odometer = interaction.options.getNumber("odometer", true);
      const grossPay = interaction.options.getNumber("grosspay", true);
      const tipOption = interaction.options.getNumber("tippercent", false);
      const tipPercent = tipOption === null ? 0.5 : tipOption;
      const existing = activeShifts.get(interaction.user.id);

      if (!existing) {
        await interaction.reply({
          content: "No active shift found. Use /startshift first.",
          flags: ephemeralFlag,
        });
        return;
      }

      if (odometer < existing.odometer) {
        await interaction.reply({
          content:
            "End odometer must be greater than or equal to the start odometer.",
          flags: ephemeralFlag,
        });
        return;
      }

      if (tipPercent < 0 || tipPercent > 1) {
        await interaction.reply({
          content:
            "tippercent must be a decimal between 0 and 1 (for example, 0.5 = 50%).",
          flags: ephemeralFlag,
        });
        return;
      }

      const shift = new Shift({
        startTime: existing.startTimestamp,
        startOdometer: existing.odometer,
        carRef: existing.carRef,
        fuelPriceAtStart: existing.fuelPriceAtStart,
        endTime: Date.now(),
        endOdometer: odometer,
        grossPay,
        percentTips: tipPercent,
      });

      pendingShiftSyncs.push({ userId: interaction.user.id, shift });
      completedShiftHistory.push({ userId: interaction.user.id, shift, finishedAt: Date.now() });
      activeShifts.delete(interaction.user.id);

      const shiftSummaryEmbed = new EmbedBuilder()
        .setColor(0x5865f2) // Blurple
        .setTitle("📊 Shift Summary Report")
        .setDescription(
          `Great work! Your shift details have been calculated below.`,
        )
        .setTimestamp()
        .addFields(
          {
            name: "💰 Earnings",
            value: `**Gross Pay:** $${shift.grossPay.toFixed(2)}
**Rate:** $${shift.hourlyGrossPay.toFixed(2)}/hour
**Per Mile:** $${shift.perMileGrossPay.toFixed(2)}/mile`,
            inline: true,
          },
          {
            name: "🚗 Travel",
            value: `**Avg Speed:** ${shift.averageSpeed.toFixed(2)} mph
**Distance:** ${shift.milesDriven.toLocaleString()} mi
**Odometer:** ${shift.startOdometer.toLocaleString()} → ${shift.endOdometer.toLocaleString()} mi`,
            inline: true,
          },
          {
            name: "🕒 Timing",
            value: `**Duration:** ${shift.hoursTaken.toFixed(2)} hours
**Started:** <t:${Math.floor(shift.startTime / 1000)}:F>
**Ended:** <t:${Math.floor(shift.endTime / 1000)}:F>`,
            inline: false,
          },
          {
            name: "📉 *Estimated Expenses",
            value: `**Fuel:** $${(shift.fuelCost).toFixed(2)}
**Wear & Tear:** $${(shift.wearAndTearCost).toFixed(2)}
*(Depreciation: $${shift.depreciationCost.toFixed(2)} + Maintenance: $${shift.maintenanceCost.toFixed(2)} + Repair: $${shift.repairCost.toFixed(2)})*
**Taxes:** $${(shift.taxCost).toFixed(2)}
*(Tip %: ${Math.round(shift.percentTips * 100)}%)*`,
            inline: false,
          },
          {
            name: "💸 *Estimated Final Take-Home",
            value: `**Net Pay:** $${(shift.netPay).toFixed(2)}
**Net Rate:** $${(shift.hourlyNetPay).toFixed(2)}/hr`,
            inline: false,
          },
        )
        .setFooter({ text: "*Estimates based on your /config" });

      await interaction.reply({
        embeds: [shiftSummaryEmbed],
      });
      break;
    }
    case "createcar": {
      const nickname = interaction.options.getString("nickname", true).trim();
      const fuelType = interaction.options.getString("fueltype", true).trim();
      const efficiency = interaction.options.getNumber("efficiency", true);
      const depreciationCostPerMile = interaction.options.getNumber("depreciationcostpermile", true);
      const maintenanceCostPerMile = interaction.options.getNumber("maintenancecostpermile", true);
      const repairCostPerMile = interaction.options.getNumber("repaircostpermile", true);

      if (efficiency <= 0) {
        await interaction.reply({
          content: "Efficiency must be a positive number.",
          flags: ephemeralFlag,
        });
        break;
      }

      if (depreciationCostPerMile < 0 || maintenanceCostPerMile < 0 || repairCostPerMile < 0) {
        await interaction.reply({
          content: "Cost values must be zero or greater.",
          flags: ephemeralFlag,
        });
        break;
      }

      const carId = getNextCarId(interaction.user.id);
      const newCar = new Car({
        id: carId,
        nickname,
        fuelType,
        efficiency,
        depreciationCostPerMile,
        maintenanceCostPerMile,
        repairCostPerMile,
      });

      const currentCars = getUserCars(interaction.user.id);
      saveUserCars(interaction.user.id, [...currentCars, newCar]);

      const carCreatedEmbed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("✅ Car Created")
        .setDescription(`Your car ${nickname} has been saved with ID ${carId}. Use /startshift carid:${carId} to select it.`)
        .addFields(
          { name: "Fuel Type", value: `${fuelType}`, inline: true },
          { name: "Efficiency", value: `${efficiency}`, inline: true },
          { name: "Depreciation", value: `$${depreciationCostPerMile}/mi`, inline: true },
          { name: "Maintenance", value: `$${maintenanceCostPerMile}/mi`, inline: true },
          { name: "Repair", value: `$${repairCostPerMile}/mi`, inline: true },
        );

      await interaction.reply({ embeds: [carCreatedEmbed] });
      break;
    }
    case "listcars": {
      const cars = getUserCars(interaction.user.id);
      if (cars.length === 0) {
        await interaction.reply({
          content: "You do not have any saved cars yet. Use /createcar to add one.",
          flags: ephemeralFlag,
        });
        break;
      }

      await interaction.reply({ embeds: [buildCarListEmbed(cars)] });
      break;
    }
    case "shifthistory": {
      const userHistory = completedShiftHistory.filter((entry) => entry.userId === interaction.user.id);
      const active = activeShifts.get(interaction.user.id);

      if (userHistory.length === 0) {
        const noHistoryEmbed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle("📁 Shift History")
          .setDescription("You do not have any completed shifts in history yet.");

        if (active) {
          const activeStart = `<t:${Math.floor(active.startTimestamp / 1000)}:F>`;
          noHistoryEmbed.addFields({
            name: "🟡 Active Shift",
            value: `Started at ${activeStart}\nOdometer: ${active.odometer.toLocaleString()} mi`,
            inline: false,
          });
        }

        await interaction.reply({ embeds: [noHistoryEmbed] });
        break;
      }

      const initialIndex = 0;
      const historyMessage = await interaction.reply({
        embeds: [buildShiftSummaryEmbed(userHistory[initialIndex].shift, initialIndex, userHistory.length)],
        components: [buildHistoryButtons(initialIndex, userHistory.length)],
        fetchReply: true,
      });

      shiftHistorySessions.set(historyMessage.id, {
        userId: interaction.user.id,
        shifts: userHistory,
        currentIndex: initialIndex,
      });
      break;
    }
    case "shiftssummary": {
      const userHistory = completedShiftHistory.filter((entry) => entry.userId === interaction.user.id);
      if (userHistory.length === 0) {
        await interaction.reply({
          content: "You do not have any completed shifts yet. Finish a shift with /endshift to build your summary.",
          flags: ephemeralFlag,
        });
        break;
      }

      const stats = userHistory.reduce(
        (acc, entry) => {
          const shift = entry.shift;
          acc.totalGrossPay += shift.grossPay;
          acc.totalNetPay += shift.netPay;
          acc.totalFuelCost += shift.fuelCost;
          acc.totalWearAndTear += shift.wearAndTearCost;
          acc.totalTaxCost += shift.taxCost;
          acc.totalHours += shift.hoursTaken;
          acc.totalMiles += shift.milesDriven;
          return acc;
        },
        {
          totalGrossPay: 0,
          totalNetPay: 0,
          totalFuelCost: 0,
          totalWearAndTear: 0,
          totalTaxCost: 0,
          totalHours: 0,
          totalMiles: 0,
        },
      );

      const summaryStats = {
        ...stats,
        averageHourlyGross: stats.totalHours > 0 ? stats.totalGrossPay / stats.totalHours : 0,
        averageHourlyNet: stats.totalHours > 0 ? stats.totalNetPay / stats.totalHours : 0,
        averageSpeed: stats.totalHours > 0 ? stats.totalMiles / stats.totalHours : 0,
      };

      await interaction.reply({ embeds: [buildShiftTotalsEmbed(summaryStats)] });
      break;
    }
    default:
      await interaction.reply({
        content: "Unknown command!",
        flags: ephemeralFlag,
      });
      break;
  }
});

client.on("messageCreate", async (message) => {
  // Ignore other bots
  if (message.author.bot) return;

  // Check if the message is a Direct Message (not in a server)
  if (!message.guild) {
    console.log(`DM from ${message.author.tag}: ${message.content}`);

    // Response
    await message.reply(
      `Message received! ${message.author.tag} said: "${message.content}"`,
    );
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);