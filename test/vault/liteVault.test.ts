import { ethers } from "hardhat";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Event } from "ethers";

import {
  LiteVault__factory,
  LiteVault,
  IERC20Upgradeable,
  IERC20Upgradeable__factory,
} from "../../typechain-types";

chai.use(chaiAsPromised);
chai.use(solidity);
const { expect } = chai;
const hre = require("hardhat");

const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const usdcAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const usdcWhale = "0xd6216fc19db775df9774a6e33526131da7d19a2c";

describe("LiteVault", () => {
  const defaultDepositAmount = toUsdcBigNumber(1000);

  const minimumThresholdPercentage = 10000000; // 10%
  const withdrawFeePercentage = 10000; // 0.01%
  const withdrawFeeAbsoluteMin = toUsdcBigNumber(20); // usdc has 6 decimals -> 20 USDC.
  const mainnetExchangePrice = toUsdcBigNumber(2);

  let vault: LiteVault;
  let owner: SignerWithAddress;
  let usdc: IERC20Upgradeable;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let rebalancer: SignerWithAddress;
  let bridge: SignerWithAddress;

  before(async () => {
    const signers = await ethers.getSigners();
    owner = signers[0];
    user1 = signers[1];
    user2 = signers[2];
    rebalancer = signers[3];
    bridge = signers[4];

    usdc = IERC20Upgradeable__factory.connect(usdcAddress, owner);

    // send some usdc to users
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [usdcWhale],
    });
    await usdc
      .connect(await ethers.getSigner(usdcWhale))
      .transfer(user1.address, toUsdcBigNumber(5000000), {
        gasLimit: 500000,
      });
    expect(
      (await usdc.balanceOf(user1.address)).gte(toUsdcBigNumber(5000000))
    ).to.equal(true);

    await usdc
      .connect(await ethers.getSigner(usdcWhale))
      .transfer(user2.address, toUsdcBigNumber(5000000), {
        gasLimit: 500000,
      });
    expect(
      (await usdc.balanceOf(user2.address)).gte(toUsdcBigNumber(5000000))
    ).to.equal(true);
  });

  beforeEach(async () => {
    const vaultFactory = (await ethers.getContractFactory(
      "LiteVault",
      owner
    )) as LiteVault__factory;
    vault = await vaultFactory.deploy();
    await vault.deployed();

    expect(await vault.owner()).to.eq(ADDRESS_ZERO);
    expect(await vault.asset()).to.eq(ADDRESS_ZERO);
  });

  describe("initialize", async () => {
    const subject = async () => {
      return vault.initialize(
        owner.address,
        usdc.address,
        minimumThresholdPercentage,
        withdrawFeePercentage,
        withdrawFeeAbsoluteMin,
        bridge.address,
        mainnetExchangePrice
      );
    };

    it("should revert if already initialized", async () => {
      await subject();
      await expect(subject()).to.be.revertedWith(
        "Initializable: contract is already initialized"
      );
    });

    it("should initialize", async () => {
      await subject();
      expect(await vault.owner()).to.eq(owner.address);
      expect(await vault.asset()).to.eq(usdc.address);
      expect(await vault.minimumThresholdPercentage()).to.eq(
        minimumThresholdPercentage
      );
      expect(await vault.withdrawFeePercentage()).to.eq(withdrawFeePercentage);
      expect(await vault.withdrawFeeAbsoluteMin()).to.eq(
        withdrawFeeAbsoluteMin
      );
      expect(await vault.bridgeAddress()).to.eq(bridge.address);
      expect(await vault.mainnetExchangePrice()).to.eq(mainnetExchangePrice);
    });
  });

  context("when initialized", async () => {
    beforeEach(async () => {
      await vault.initialize(
        owner.address,
        usdc.address,
        minimumThresholdPercentage,
        withdrawFeePercentage,
        withdrawFeeAbsoluteMin,
        bridge.address,
        mainnetExchangePrice
      );
    });

    describe("deposit", async () => {
      // not thoroughly tested, this is actually already covered by OpenZeppelin.
      it("should deposit", async () => {
        expect(await vault.balanceOf(user1.address)).to.equal(0);
        // approve
        await usdc.connect(user1).approve(vault.address, defaultDepositAmount);

        // deposit
        await vault.connect(user1).deposit(defaultDepositAmount, user1.address);

        // check
        expect((await vault.balanceOf(user1.address)).gt(0)).to.equal(true);
      });
    });

    describe("mint", async () => {
      // not thoroughly tested, this is actually already covered by OpenZeppelin.
      it("should mint", async () => {
        expect(await vault.balanceOf(user1.address)).to.equal(0);

        // approve
        await usdc.connect(user1).approve(vault.address, defaultDepositAmount);

        // deposit
        await vault.connect(user1).mint(100, user1.address);

        // check
        expect((await vault.balanceOf(user1.address)).eq(100)).to.equal(true);
      });
    });

    context(
      "when initialized & default deposit for users & rebalancer set",
      async () => {
        beforeEach(async () => {
          await usdc
            .connect(user1)
            .approve(vault.address, defaultDepositAmount);
          await vault
            .connect(user1)
            .deposit(defaultDepositAmount, user1.address);

          await usdc
            .connect(user2)
            .approve(vault.address, defaultDepositAmount);
          await vault
            .connect(user2)
            .deposit(defaultDepositAmount, user2.address);

          await vault.connect(owner).setRebalancer(rebalancer.address, true);
        });

        describe("withdraw and redeem", async () => {
          describe("withdraw", async () => {
            it("should withdraw", async () => {
              expect((await vault.balanceOf(user1.address)).gt(0)).to.equal(
                true
              );
              await vault
                .connect(user1)
                .withdraw(defaultDepositAmount, user1.address, user1.address);
              expect(await vault.balanceOf(user1.address)).to.equal(0);
            });

            it("should collect withdraw fee as asbolute", async () => {
              const initialBalance = await vault.collectedFees();

              await vault
                .connect(user1)
                .withdraw(defaultDepositAmount, user1.address, user1.address);

              expect(
                (await vault.collectedFees()).eq(
                  initialBalance.add(withdrawFeeAbsoluteMin)
                )
              ).to.equal(true);
            });

            it("should collect withdraw fee as percentage", async () => {
              // deposit more to withdraw more
              const bigDeposit = toUsdcBigNumber(1000000);
              await usdc.connect(user1).approve(vault.address, bigDeposit);
              await vault.connect(user1).deposit(bigDeposit, user1.address);

              const initialBalance = await vault.collectedFees();

              await vault
                .connect(user1)
                .withdraw(bigDeposit, user1.address, user1.address);

              expect(
                (await vault.collectedFees()).eq(
                  initialBalance.add(bigDeposit.div(10000)) // bigDeposit / 10000 = 0.01%
                )
              ).to.equal(true);
            });

            it("should emit WithdrawFeeCollected event", async () => {
              const result = await vault
                .connect(user1)
                .withdraw(defaultDepositAmount, user1.address, user1.address);

              const events = (await result.wait())?.events as Event[];
              expect(events?.length).to.be.greaterThanOrEqual(1);
              expect(events[0]?.event).to.equal("WithdrawFeeCollected");
              expect(events[0]?.args?.payer).to.equal(user1.address);
              expect(events[0]?.args?.fee).to.equal(withdrawFeeAbsoluteMin);
            });
          });

          describe("redeem", async () => {
            it("should redeem", async () => {
              const initialShares = await vault.balanceOf(user1.address);
              expect(initialShares.gt(0)).to.equal(true);

              await vault
                .connect(user1)
                .redeem(initialShares.div(2), user1.address, user1.address);

              expect(
                (await vault.balanceOf(user1.address)).eq(initialShares.div(2))
              ).to.equal(true);
            });

            it("should collect withdraw fee as asbolute", async () => {
              const initialBalance = await vault.collectedFees();
              const initialShares = await vault.balanceOf(user1.address);

              await vault
                .connect(user1)
                .redeem(initialShares, user1.address, user1.address);

              expect(
                (await vault.collectedFees()).eq(
                  initialBalance.add(withdrawFeeAbsoluteMin)
                )
              ).to.equal(true);
            });

            it("should collect withdraw fee as percentage", async () => {
              // deposit more to withdraw more
              const bigDeposit = toUsdcBigNumber(1000000);
              await usdc.connect(user1).approve(vault.address, bigDeposit);
              const initialShares = await vault.balanceOf(user1.address);
              await vault.connect(user1).deposit(bigDeposit, user1.address);

              const initialBalance = await vault.collectedFees();
              const depositedShares = (
                await vault.balanceOf(user1.address)
              ).sub(initialShares);

              await vault
                .connect(user1)
                .redeem(depositedShares, user1.address, user1.address);

              expect(
                (await vault.collectedFees()).eq(
                  initialBalance.add(bigDeposit.div(withdrawFeePercentage)) // bigDeposit / 10000 = 0.01%
                )
              ).to.equal(true);
            });

            it("should emit WithdrawFeeCollected event", async () => {
              const initialShares = await vault.balanceOf(user1.address);

              const result = await vault
                .connect(user1)
                .redeem(initialShares, user1.address, user1.address);

              const events = (await result.wait())?.events as Event[];
              expect(events?.length).to.be.greaterThanOrEqual(1);
              expect(events[0]?.event).to.equal("WithdrawFeeCollected");
              expect(events[0]?.args?.payer).to.equal(user1.address);
              expect(events[0]?.args?.fee).to.equal(withdrawFeeAbsoluteMin);
            });
          });

          describe("redeemExcess", async () => {
            const subject = async () => {
              const initialShares = await vault.balanceOf(user1.address);
              expect(initialShares.gt(0)).to.equal(true);

              // burn all shares for just half the deposit amount
              return vault
                .connect(user1)
                .redeemExcess(defaultDepositAmount.div(2), initialShares);
            };

            it("should redeemExcess", async () => {
              const initialUsdcBalance = await usdc.balanceOf(user1.address);

              await subject();

              expect((await vault.balanceOf(user1.address)).eq(0)).to.equal(
                true
              );

              expect(
                (await usdc.balanceOf(user1.address))
                  .sub(initialUsdcBalance)
                  .eq(defaultDepositAmount.div(2).sub(withdrawFeeAbsoluteMin))
              ).to.equal(true);
            });

            it("should collect withdraw fee as asbolute", async () => {
              const initialBalance = await vault.collectedFees();

              await subject();

              expect(
                (await vault.collectedFees()).eq(
                  initialBalance.add(withdrawFeeAbsoluteMin)
                )
              ).to.equal(true);
            });

            it("should collect withdraw fee as percentage", async () => {
              // deposit more to withdraw more
              const bigDeposit = toUsdcBigNumber(1000000);
              await usdc.connect(user1).approve(vault.address, bigDeposit);
              await vault.connect(user1).deposit(bigDeposit, user1.address);

              const initialBalance = await vault.collectedFees();
              const depositedShares = await vault.balanceOf(user1.address);

              await vault
                .connect(user1)
                .redeemExcess(bigDeposit, depositedShares);

              expect(
                (await vault.collectedFees()).eq(
                  initialBalance.add(bigDeposit.div(withdrawFeePercentage)) // bigDeposit / 10000 = 0.01%
                )
              ).to.equal(true);

              expect(await vault.balanceOf(user1.address)).to.equal(0);
            });

            it("should emit WithdrawFeeCollected event", async () => {
              const result = await subject();

              const events = (await result.wait())?.events as Event[];
              expect(events?.length).to.be.greaterThanOrEqual(1);
              expect(events[0]?.event).to.equal("WithdrawFeeCollected");
              expect(events[0]?.args?.payer).to.equal(user1.address);
              expect(events[0]?.args?.fee).to.equal(withdrawFeeAbsoluteMin);
            });
          });
        });

        describe("public getters", async () => {
          describe("getWithdrawFee", async () => {
            const subject = async (amount: BigNumber) => {
              return vault.getWithdrawFee(amount);
            };

            it("should getWithdrawFee as absolute", async () => {
              const result = await subject(defaultDepositAmount);
              expect(result.eq(withdrawFeeAbsoluteMin)).to.equal(true);
            });

            it("should getWithdrawFee as percentage", async () => {
              // deposit more to get a bigger fee base
              const bigDeposit = toUsdcBigNumber(1000000);
              await usdc.connect(user1).approve(vault.address, bigDeposit);
              await vault.connect(user1).deposit(bigDeposit, user1.address);

              const result = await subject(bigDeposit);
              expect(result.eq(bigDeposit.div(withdrawFeePercentage))).to.equal(
                true
              );
            });
          });

          describe("getRedeemFee", async () => {
            const subject = async (amount: BigNumber) => {
              const shares = await vault.previewWithdraw(amount);
              return vault.getRedeemFee(shares);
            };

            it("should getRedeemFee as absolute", async () => {
              const result = await subject(defaultDepositAmount);
              expect(result.eq(withdrawFeeAbsoluteMin)).to.equal(true);
            });

            it("should getRedeemFee as percentage", async () => {
              // deposit more to get a bigger fee base
              const bigDeposit = toUsdcBigNumber(1000000);
              await usdc.connect(user1).approve(vault.address, bigDeposit);
              await vault.connect(user1).deposit(bigDeposit, user1.address);

              const result = await subject(bigDeposit);
              expect(result.eq(bigDeposit.div(withdrawFeePercentage))).to.equal(
                true
              );
            });
          });

          describe("minimumThresholdAmount", async () => {
            const subject = async () => {
              return vault.minimumThresholdAmount();
            };

            it("should get minimumThresholdAmount for totalAssets = 0", async () => {
              // execute withdraw for all users
              await vault
                .connect(user1)
                .withdraw(defaultDepositAmount, user1.address, user1.address);
              await vault
                .connect(user2)
                .withdraw(defaultDepositAmount, user2.address, user2.address);

              const result = await subject();
              expect(result).to.equal(0);
            });

            it("should get minimumThresholdAmount for totalAssets != 0", async () => {
              const result = await subject();
              // deposit is 10% of 2x defaultDepositAmount -> 10% of 2000 = 200
              expect(result).to.equal(toUsdcBigNumber(200));
            });
          });

          describe("totalAssets", async () => {
            const subject = async () => {
              return vault.totalAssets();
            };

            it("should get totalAssets", async () => {
              const result = await subject();
              // should be 2x defaultDeposit -> 2 x 1000
              expect(result).to.equal(toUsdcBigNumber(2000));
            });

            it("should combine investedAssets and contract balance", async () => {
              expect(await subject()).to.equal(toUsdcBigNumber(2000));
              // toMainnet should not influence the total balance
              await vault.connect(rebalancer).toMainnet(toUsdcBigNumber(1000));
              expect(await subject()).to.equal(toUsdcBigNumber(2000));
            });

            it("should get totalAssets according to mainnetExchangePrice", async () => {
              await vault.connect(rebalancer).toMainnet(toUsdcBigNumber(1000));
              // after toMainnet totalAssets should be 2000
              expect(await subject()).to.equal(toUsdcBigNumber(2000));
              // change mainnetExchangePrice
              await vault
                .connect(bridge)
                .updateMainnetExchangePrice(mainnetExchangePrice.mul(2));
              // after changing the price to double the result should be 3000.
              // because 1000 was invested and doubled in vlaue
              expect(await subject()).to.equal(toUsdcBigNumber(3000));
            });
          });

          describe("totalInvestedAssets", async () => {
            const subject = async () => {
              return vault.totalInvestedAssets();
            };

            it("should get totalInvestedAssets", async () => {
              // before toMainnet totalInvestedAssets should be 0
              expect(await subject()).to.equal(0);
              await vault.connect(rebalancer).toMainnet(toUsdcBigNumber(1000));
              // after toMainnet totalInvestedAssets should be 1000; it tracks the raw invested amount
              expect(await subject()).to.equal(toUsdcBigNumber(1000));
            });

            it("should get totalInvestedAssets according to mainnetExchangePrice", async () => {
              await vault.connect(rebalancer).toMainnet(toUsdcBigNumber(1000));
              // after toMainnet totalInvestedAssets should be 1000; it tracks the raw value of bridged investments
              expect(await subject()).to.equal(toUsdcBigNumber(1000));
              // change mainnetExchangePrice
              await vault
                .connect(bridge)
                .updateMainnetExchangePrice(mainnetExchangePrice.mul(2));
              // after changing the price to double the result should be 2000
              expect(await subject()).to.equal(toUsdcBigNumber(2000));
            });
          });

          describe("bridge actions", async () => {
            describe("updateMainnetExchangePrice", async () => {
              const subject = async (
                value: BigNumber,
                sender: SignerWithAddress
              ) => {
                return vault.connect(sender).updateMainnetExchangePrice(value);
              };

              it("should updateMainnetExchangePrice", async () => {
                expect(
                  (await vault.mainnetExchangePrice()).eq(mainnetExchangePrice)
                ).to.equal(true);

                await subject(toUsdcBigNumber(5), bridge);

                expect(
                  (await vault.mainnetExchangePrice()).eq(toUsdcBigNumber(5))
                ).to.equal(true);
              });

              it("should revert if not bridge", async () => {
                await expect(
                  subject(toUsdcBigNumber(5), rebalancer)
                ).to.be.revertedWith("LiteVault__Unauthorized");
              });
            });
          });

          describe("rebalancer actions", async () => {
            describe("toMainnet", async () => {
              const subject = async (
                value: BigNumber,
                sender: SignerWithAddress
              ) => {
                return vault.connect(sender).toMainnet(value);
              };

              it("should toMainnet", async () => {
                // default deposit is 2000 so up to 1800 should be possible to move (minimumThreshold is 10%)
                expect(await vault.totalInvestedAssets()).to.equal(0);

                await subject(toUsdcBigNumber(1800), rebalancer);

                expect(await vault.totalInvestedAssets()).to.equal(
                  toUsdcBigNumber(1800)
                );
              });

              it("should emit ToMainnet", async () => {
                const result = await subject(toUsdcBigNumber(1800), rebalancer);

                const events = (await result.wait())?.events as Event[];
                expect(events?.length).to.be.greaterThanOrEqual(1);
                expect(events[events.length - 1].event).to.equal("ToMainnet");
                expect(
                  events[events.length - 1]?.args?.amountMoved.eq(
                    toUsdcBigNumber(1800)
                  )
                ).to.equal(true);
                expect(events[events.length - 1]?.args?.bridgeAddress).to.equal(
                  bridge.address
                );
              });

              it("should revert if moving more than minimum threshold", async () => {
                await expect(
                  subject(toUsdcBigNumber(1900), rebalancer)
                ).to.be.revertedWith("LiteVault__ExceedMinimumThreshold");
              });

              it("should revert if not rebalancer", async () => {
                await expect(
                  subject(toUsdcBigNumber(1500), user1)
                ).to.be.revertedWith("LiteVault__Unauthorized");
              });
            });

            describe("fromMainnet", async () => {
              const amountToMove = toUsdcBigNumber(1800);

              beforeEach(async () => {
                // use toMainnet before so that investedAssets is increased
                await vault.connect(rebalancer).toMainnet(amountToMove);
              });

              const subject = async (
                value: BigNumber,
                sender: SignerWithAddress
              ) => {
                // approve assets from bridge to vault
                await usdc.connect(bridge).approve(vault.address, value);

                return vault.connect(sender).fromMainnet(value);
              };

              it("should fromMainnet", async () => {
                await subject(amountToMove, rebalancer);

                expect(await vault.totalInvestedAssets()).to.equal(0);
              });

              it("should emit FromMainnet", async () => {
                const result = await subject(amountToMove, rebalancer);

                const events = (await result.wait())?.events as Event[];
                expect(events?.length).to.be.greaterThanOrEqual(1);
                expect(events[events.length - 1].event).to.equal("FromMainnet");
                expect(
                  events[events.length - 1]?.args?.amountMoved.eq(amountToMove)
                ).to.equal(true);
                expect(events[events.length - 1]?.args?.bridgeAddress).to.equal(
                  bridge.address
                );
              });

              it("should revert if not rebalancer", async () => {
                await expect(subject(amountToMove, user1)).to.be.revertedWith(
                  "LiteVault__Unauthorized"
                );
              });
            });
          });
        });

        describe("owner actions", async () => {
          describe("setMinimumThresholdPercentage", async () => {
            const subject = async (
              value: number,
              sender: SignerWithAddress
            ) => {
              return vault.connect(sender).setMinimumThresholdPercentage(value);
            };

            it("should setMinimumThresholdPercentage", async () => {
              expect(await vault.minimumThresholdPercentage()).to.equal(
                10000000
              );

              await subject(20000000, owner);

              expect(await vault.minimumThresholdPercentage()).to.equal(
                20000000
              );
            });

            it("should revert if not owner", async () => {
              await expect(subject(2000000, user1)).to.be.revertedWith(
                "Ownable: caller is not the owner"
              );
            });

            it("should revert if not valid percentage amount", async () => {
              // setting > 100% e.g. 110% should not be possible
              await expect(subject(110000000, owner)).to.be.revertedWith(
                "LiteVault__InvalidParams"
              );
            });
          });

          describe("setRebalancer", async () => {
            const subject = async (
              addressToSet: string,
              value: boolean,
              sender: SignerWithAddress
            ) => {
              return vault.connect(sender).setRebalancer(addressToSet, value);
            };

            it("should setRebalancer flag true", async () => {
              expect(await vault.allowedRebalancers(user1.address)).to.equal(
                false
              );

              await subject(user1.address, true, owner);

              expect(await vault.allowedRebalancers(user1.address)).to.equal(
                true
              );
            });

            it("should setRebalancer flag false", async () => {
              await subject(user1.address, true, owner);

              expect(await vault.allowedRebalancers(user1.address)).to.equal(
                true
              );

              await subject(user1.address, false, owner);

              expect(await vault.allowedRebalancers(user1.address)).to.equal(
                false
              );
            });

            it("should revert if not owner", async () => {
              await expect(
                subject(user1.address, true, user1)
              ).to.be.revertedWith("Ownable: caller is not the owner");
            });
          });

          describe("setWithdrawFeeAbsoluteMin", async () => {
            const subject = async (
              value: BigNumber,
              sender: SignerWithAddress
            ) => {
              return vault.connect(sender).setWithdrawFeeAbsoluteMin(value);
            };

            it("should setWithdrawFeeAbsoluteMin", async () => {
              expect(
                (await vault.withdrawFeeAbsoluteMin()).eq(toUsdcBigNumber(20))
              ).to.equal(true);

              await subject(toUsdcBigNumber(50), owner);

              expect(
                (await vault.withdrawFeeAbsoluteMin()).toNumber()
              ).to.equal(toUsdcBigNumber(50));
            });

            it("should revert if not owner", async () => {
              await expect(
                subject(toUsdcBigNumber(50), user1)
              ).to.be.revertedWith("Ownable: caller is not the owner");
            });
          });

          describe("setWithdrawFeePercentage", async () => {
            const subject = async (
              value: number,
              sender: SignerWithAddress
            ) => {
              return vault.connect(sender).setWithdrawFeePercentage(value);
            };

            it("should setWithdrawFeePercentage", async () => {
              expect(await vault.withdrawFeePercentage()).to.equal(10000);

              await subject(20000, owner);

              expect(await vault.withdrawFeePercentage()).to.equal(20000);
            });

            it("should revert if not owner", async () => {
              await expect(subject(20000, user1)).to.be.revertedWith(
                "Ownable: caller is not the owner"
              );
            });

            it("should revert if not valid percentage amount", async () => {
              // setting > 100% e.g. 110% should not be possible
              await expect(subject(110000000, owner)).to.be.revertedWith(
                "LiteVault__InvalidParams"
              );
            });
          });

          describe("setBridgeAddress", async () => {
            const subject = async (
              value: string,
              sender: SignerWithAddress
            ) => {
              return vault.connect(sender).setBridgeAddress(value);
            };

            it("should setBridgeAddress", async () => {
              expect(await vault.bridgeAddress()).to.equal(bridge.address);

              await subject(user2.address, owner);

              expect(await vault.bridgeAddress()).to.equal(user2.address);
            });

            it("should revert if not owner", async () => {
              await expect(subject(user1.address, user1)).to.be.revertedWith(
                "Ownable: caller is not the owner"
              );
            });

            it("should revert if not valid address", async () => {
              await expect(subject(ADDRESS_ZERO, owner)).to.be.revertedWith(
                "LiteVault__InvalidParams"
              );
            });
          });

          describe("withdrawFees", async () => {
            const subject = async (
              receiver: string,
              sender: SignerWithAddress
            ) => {
              return vault.connect(sender).withdrawFees(receiver);
            };

            it("should withdrawFees", async () => {
              const initialBalance = await usdc.balanceOf(user1.address);

              // withdraw with user 2 to generate some withdraw fees
              await vault
                .connect(user2)
                .withdraw(defaultDepositAmount, user2.address, user2.address);

              const withdrawableFees = await vault.collectedFees();
              expect(withdrawableFees.gt(0)).to.equal(true);

              await subject(user1.address, owner);

              const afterBalance = await usdc.balanceOf(user1.address);

              expect(
                afterBalance.sub(initialBalance).eq(withdrawableFees)
              ).to.equal(true);
            });

            it("should revert if not owner", async () => {
              await expect(subject(user1.address, user1)).to.be.revertedWith(
                "Ownable: caller is not the owner"
              );
            });

            it("should revert if not valid address", async () => {
              await expect(subject(ADDRESS_ZERO, owner)).to.be.revertedWith(
                "LiteVault__InvalidParams"
              );
            });
          });
        });
      }
    );
  });

  function toUsdcBigNumber(amount: number) {
    return BigNumber.from(amount * 1e6);
  }
});
