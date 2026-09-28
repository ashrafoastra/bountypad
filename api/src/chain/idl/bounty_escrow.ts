/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/bounty_escrow.json`.
 */
export type BountyEscrow = {
  "address": "BPADDJVZ2YAYgBG1hngg7a6YL5KPYaicKyzbk7AjRQ1Y",
  "metadata": {
    "name": "bountyEscrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Bounty Pad: locks each coin's bounty pot until 2 of 3 verifiers attest the target did the action"
  },
  "instructions": [
    {
      "name": "assignWallet",
      "docs": [
        "Path 2: the target logged in with X and got a wallet. 2 of 3 verifiers bind it."
      ],
      "discriminator": [
        163,
        206,
        90,
        162,
        210,
        158,
        120,
        96
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "payoutWallet",
          "type": "pubkey"
        },
        {
          "name": "expiry",
          "type": "i64"
        }
      ]
    },
    {
      "name": "cancel",
      "docs": [
        "Admin: the verification was wrong. The challenge reopens; the pot stays locked."
      ],
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "createBounty",
      "docs": [
        "Written in the same transaction as the Meteora pool. The pool must exist, use our",
        "launchpad config, be for this mint, and be created by the same wallet."
      ],
      "discriminator": [
        122,
        90,
        14,
        143,
        8,
        125,
        200,
        2
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "pool"
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "bountyArgs"
            }
          }
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Anyone (the fee keeper) adds SOL to a pot."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "expire",
      "docs": [
        "Permissionless. Deadline (+ grace) passed with no verified action: pot to the burn treasury."
      ],
      "discriminator": [
        243,
        83,
        205,
        58,
        57,
        201,
        247,
        146
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "freeze",
      "docs": [
        "Admin: stop a payout during the challenge window (e.g. the account was hacked)."
      ],
      "discriminator": [
        255,
        91,
        207,
        84,
        251,
        194,
        254,
        63
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "docs": [
        "One-time setup by the deployer. `admin` should be the 2-of-3 Squads multisig on mainnet."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        }
      ]
    },
    {
      "name": "optOut",
      "docs": [
        "2 of 3 verifiers attest the target opted out of bounties: pot to the burn treasury."
      ],
      "discriminator": [
        155,
        214,
        195,
        27,
        225,
        33,
        157,
        215
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "expiry",
          "type": "i64"
        }
      ]
    },
    {
      "name": "release",
      "docs": [
        "Permissionless. After the challenge window, sends the whole pot to the payout wallet.",
        "Also sweeps fees that arrive after payment to the same wallet."
      ],
      "discriminator": [
        253,
        249,
        15,
        206,
        28,
        127,
        193,
        241
      ],
      "accounts": [
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "payoutWallet",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "unfreeze",
      "docs": [
        "Admin: false alarm. The challenge window starts again."
      ],
      "discriminator": [
        133,
        160,
        68,
        253,
        80,
        232,
        218,
        247
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
      "docs": [
        "Admin: rotate verifiers, change the window, the treasury, or hand admin to the multisig."
      ],
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        },
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "verify",
      "docs": [
        "2 of 3 verifiers attest the post. `payout_wallet` may be the default key when the target",
        "has no wallet yet (Path 2); it is then set later with `assign_wallet`."
      ],
      "discriminator": [
        133,
        161,
        141,
        48,
        120,
        198,
        88,
        150
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.mint",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "postId",
          "type": "u64"
        },
        {
          "name": "payoutWallet",
          "type": "pubkey"
        },
        {
          "name": "expiry",
          "type": "i64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bounty",
      "discriminator": [
        237,
        16,
        105,
        198,
        19,
        69,
        242,
        234
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    }
  ],
  "events": [
    {
      "name": "bountyCreated",
      "discriminator": [
        68,
        252,
        247,
        196,
        154,
        247,
        130,
        49
      ]
    },
    {
      "name": "burned",
      "discriminator": [
        207,
        37,
        251,
        154,
        239,
        229,
        14,
        67
      ]
    },
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "released",
      "discriminator": [
        232,
        229,
        255,
        136,
        101,
        189,
        15,
        220
      ]
    },
    {
      "name": "statusChanged",
      "discriminator": [
        146,
        235,
        222,
        125,
        145,
        246,
        34,
        240
      ]
    },
    {
      "name": "verified",
      "discriminator": [
        102,
        108,
        247,
        112,
        212,
        132,
        41,
        71
      ]
    },
    {
      "name": "walletAssigned",
      "discriminator": [
        236,
        254,
        58,
        109,
        69,
        173,
        177,
        6
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "badAction",
      "msg": "Unknown bounty action"
    },
    {
      "code": 6001,
      "name": "badTarget",
      "msg": "Missing X user id"
    },
    {
      "code": 6002,
      "name": "badDeadline",
      "msg": "Deadline must be in the future and within a year"
    },
    {
      "code": 6003,
      "name": "notDbcPool",
      "msg": "Not a Meteora bonding curve pool"
    },
    {
      "code": 6004,
      "name": "wrongLaunchpad",
      "msg": "Pool was not created on Bounty Pad"
    },
    {
      "code": 6005,
      "name": "wrongMint",
      "msg": "Pool is for a different mint"
    },
    {
      "code": 6006,
      "name": "wrongCreator",
      "msg": "Pool was created by a different wallet"
    },
    {
      "code": 6007,
      "name": "zeroAmount",
      "msg": "Amount must be above zero"
    },
    {
      "code": 6008,
      "name": "badStatus",
      "msg": "Not allowed in the bounty's current status"
    },
    {
      "code": 6009,
      "name": "deadlinePassed",
      "msg": "The bounty deadline has passed"
    },
    {
      "code": 6010,
      "name": "badPost",
      "msg": "Missing post id"
    },
    {
      "code": 6011,
      "name": "badWallet",
      "msg": "Invalid payout wallet"
    },
    {
      "code": 6012,
      "name": "noWallet",
      "msg": "No payout wallet yet"
    },
    {
      "code": 6013,
      "name": "challengeWindowOpen",
      "msg": "The challenge window is still open"
    },
    {
      "code": 6014,
      "name": "notExpired",
      "msg": "The deadline (plus grace) hasn't passed"
    },
    {
      "code": 6015,
      "name": "attestationExpired",
      "msg": "Attestation expired"
    },
    {
      "code": 6016,
      "name": "notEnoughSignatures",
      "msg": "Not enough verifier signatures"
    },
    {
      "code": 6017,
      "name": "badEd25519",
      "msg": "Malformed ed25519 instruction"
    },
    {
      "code": 6018,
      "name": "badConfig",
      "msg": "Invalid config"
    },
    {
      "code": 6019,
      "name": "overflow",
      "msg": "Math overflow"
    }
  ],
  "types": [
    {
      "name": "bounty",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "targetXUserId",
            "type": "u64"
          },
          {
            "name": "action",
            "docs": [
              "0 cashtag, 1 contract address, 2 quote launch post, 3 video phrase"
            ],
            "type": "u8"
          },
          {
            "name": "phraseHash",
            "docs": [
              "sha256 of the normalized phrase (video bounties), zero otherwise"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "postId",
            "type": "u64"
          },
          {
            "name": "payoutWallet",
            "type": "pubkey"
          },
          {
            "name": "challengeEnds",
            "type": "i64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalPaid",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bountyArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "targetXUserId",
            "type": "u64"
          },
          {
            "name": "action",
            "type": "u8"
          },
          {
            "name": "phraseHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "deadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "bountyCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "targetXUserId",
            "type": "u64"
          },
          {
            "name": "action",
            "type": "u8"
          },
          {
            "name": "deadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "burned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "verifiers",
            "docs": [
              "Main verifier, backup verifier (separate hosting), admin verifier key."
            ],
            "type": {
              "array": [
                "pubkey",
                3
              ]
            }
          },
          {
            "name": "threshold",
            "type": "u8"
          },
          {
            "name": "challengeWindow",
            "type": "i64"
          },
          {
            "name": "deadlineGrace",
            "type": "i64"
          },
          {
            "name": "treasury",
            "docs": [
              "Receives expired / opted-out pots; the keeper buys the coin with them and burns it."
            ],
            "type": "pubkey"
          },
          {
            "name": "dbcConfig",
            "docs": [
              "Our Meteora DBC config key. Only pools created with it can get a bounty."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifiers",
            "type": {
              "array": [
                "pubkey",
                3
              ]
            }
          },
          {
            "name": "threshold",
            "type": "u8"
          },
          {
            "name": "challengeWindow",
            "type": "i64"
          },
          {
            "name": "deadlineGrace",
            "type": "i64"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "dbcConfig",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "total",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "released",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "statusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "verified",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "postId",
            "type": "u64"
          },
          {
            "name": "payoutWallet",
            "type": "pubkey"
          },
          {
            "name": "challengeEnds",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "walletAssigned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "payoutWallet",
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
