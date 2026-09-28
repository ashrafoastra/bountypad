//! Bounty Pad escrow (CLAUDE.md §6.2, §6.6).
//!
//! Every coin has one `Bounty` account (PDA of its mint). The account itself holds the pot in
//! lamports. Nobody can take the pot out except through these rules:
//!
//! * `verify`      2 of 3 verifier signatures say the target did the action -> challenge window.
//! * `release`     after the window, anyone can push the pot to the attested payout wallet.
//! * `expire`      after the deadline (+ grace) with no verified action, the pot goes to the
//!                 burn treasury (the keeper buys the coin and burns it). Never to holders.
//! * `opt_out`     2 of 3 verifiers say the target refused bounties -> pot to the burn treasury.
//! * `freeze` / `unfreeze` / `cancel`   admin safety valve during the challenge window.
//!
//! The terms (target X user ID, action, phrase hash, deadline) are written once at launch and
//! can never change. Fees that arrive after a bounty is settled follow the pot: to the target
//! once paid, to the burn treasury once expired or opted out.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};

declare_id!("BPADDJVZ2YAYgBG1hngg7a6YL5KPYaicKyzbk7AjRQ1Y");

/// Meteora Dynamic Bonding Curve program (same address on devnet and mainnet).
pub const DBC_PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
/// Solana's native ed25519 signature-verify program.
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

/// Attestation message kinds. The verifier service signs exactly these bytes (see `attestation_message`).
pub const KIND_VERIFY: u8 = 1;
pub const KIND_WALLET: u8 = 2;
pub const KIND_OPT_OUT: u8 = 3;
pub const ATTESTATION_PREFIX: &[u8; 10] = b"BOUNTYPAD1";
pub const ATTESTATION_LEN: usize = 10 + 1 + 32 + 32 + 8 + 8 + 32 + 8;

/// Offsets inside Meteora's VirtualPool account (8-byte discriminator + 64-byte volatility tracker).
const POOL_CONFIG_OFFSET: usize = 72;
const POOL_CREATOR_OFFSET: usize = 104;
const POOL_BASE_MINT_OFFSET: usize = 136;

/// sha256("account:VirtualPool")[..8], Anchor's account discriminator for Meteora pools.
const VIRTUAL_POOL_DISCRIMINATOR: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];

const MAX_DEADLINE_SECS: i64 = 366 * 24 * 3600;

#[program]
pub mod bounty_escrow {
    use super::*;

    /// One-time setup by the deployer. `admin` should be the 2-of-3 Squads multisig on mainnet.
    pub fn initialize_config(ctx: Context<InitializeConfig>, args: ConfigArgs) -> Result<()> {
        args.validate()?;
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.apply(&args);
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Admin: rotate verifiers, change the window, the treasury, or hand admin to the multisig.
    pub fn update_config(ctx: Context<UpdateConfig>, args: ConfigArgs, new_admin: Pubkey) -> Result<()> {
        args.validate()?;
        let c = &mut ctx.accounts.config;
        c.apply(&args);
        c.admin = new_admin;
        Ok(())
    }

    /// Written in the same transaction as the Meteora pool. The pool must exist, use our
    /// launchpad config, be for this mint, and be created by the same wallet.
    pub fn create_bounty(ctx: Context<CreateBounty>, args: BountyArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(args.action <= 3, EscrowError::BadAction);
        require!(args.target_x_user_id > 0, EscrowError::BadTarget);
        require!(args.deadline > now && args.deadline <= now + MAX_DEADLINE_SECS, EscrowError::BadDeadline);

        let pool = &ctx.accounts.pool;
        require_keys_eq!(*pool.owner, DBC_PROGRAM_ID, EscrowError::NotDbcPool);
        let data = pool.try_borrow_data()?;
        require!(data.len() >= POOL_BASE_MINT_OFFSET + 32, EscrowError::NotDbcPool);
        require!(data[..8] == VIRTUAL_POOL_DISCRIMINATOR, EscrowError::NotDbcPool);
        let key_at = |o: usize| Pubkey::try_from(&data[o..o + 32]).unwrap();
        require_keys_eq!(key_at(POOL_CONFIG_OFFSET), ctx.accounts.config.dbc_config, EscrowError::WrongLaunchpad);
        require_keys_eq!(key_at(POOL_BASE_MINT_OFFSET), ctx.accounts.mint.key(), EscrowError::WrongMint);
        require_keys_eq!(key_at(POOL_CREATOR_OFFSET), ctx.accounts.creator.key(), EscrowError::WrongCreator);

        let b = &mut ctx.accounts.bounty;
        b.mint = ctx.accounts.mint.key();
        b.pool = pool.key();
        b.creator = ctx.accounts.creator.key();
        b.target_x_user_id = args.target_x_user_id;
        b.action = args.action;
        b.phrase_hash = args.phrase_hash;
        b.created_at = now;
        b.deadline = args.deadline;
        b.status = Status::Open as u8;
        b.bump = ctx.bumps.bounty;
        emit!(BountyCreated { bounty: b.key(), mint: b.mint, target_x_user_id: b.target_x_user_id, action: b.action, deadline: b.deadline });
        Ok(())
    }

    /// Anyone (the fee keeper) adds SOL to a pot.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer { from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.bounty.to_account_info() },
            ),
            amount,
        )?;
        let b = &mut ctx.accounts.bounty;
        b.total_deposited = b.total_deposited.checked_add(amount).ok_or(EscrowError::Overflow)?;
        emit!(Deposited { bounty: b.key(), amount, total: b.total_deposited });
        Ok(())
    }

    /// 2 of 3 verifiers attest the post. `payout_wallet` may be the default key when the target
    /// has no wallet yet (Path 2); it is then set later with `assign_wallet`.
    pub fn verify(ctx: Context<Attest>, post_id: u64, payout_wallet: Pubkey, expiry: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &ctx.accounts.config;
        let b = &ctx.accounts.bounty;
        require!(b.status == Status::Open as u8, EscrowError::BadStatus);
        require!(now <= b.deadline + cfg.deadline_grace, EscrowError::DeadlinePassed);
        require!(post_id > 0, EscrowError::BadPost);
        let msg = attestation_message(KIND_VERIFY, &b.key(), b.target_x_user_id, post_id, &payout_wallet, expiry);
        check_attestation(&ctx.accounts.instructions, cfg, &msg, expiry, now)?;

        let b = &mut ctx.accounts.bounty;
        b.status = Status::Verified as u8;
        b.post_id = post_id;
        b.payout_wallet = payout_wallet;
        b.challenge_ends = now + cfg.challenge_window;
        emit!(Verified { bounty: b.key(), post_id, payout_wallet, challenge_ends: b.challenge_ends });
        Ok(())
    }

    /// Path 2: the target logged in with X and got a wallet. 2 of 3 verifiers bind it.
    pub fn assign_wallet(ctx: Context<Attest>, payout_wallet: Pubkey, expiry: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &ctx.accounts.config;
        let b = &ctx.accounts.bounty;
        require!(b.status == Status::Verified as u8 || b.status == Status::Frozen as u8, EscrowError::BadStatus);
        require!(payout_wallet != Pubkey::default(), EscrowError::BadWallet);
        let msg = attestation_message(KIND_WALLET, &b.key(), b.target_x_user_id, b.post_id, &payout_wallet, expiry);
        check_attestation(&ctx.accounts.instructions, cfg, &msg, expiry, now)?;
        ctx.accounts.bounty.payout_wallet = payout_wallet;
        emit!(WalletAssigned { bounty: ctx.accounts.bounty.key(), payout_wallet });
        Ok(())
    }

    /// Permissionless. After the challenge window, sends the whole pot to the payout wallet.
    /// Also sweeps fees that arrive after payment to the same wallet.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let b = &ctx.accounts.bounty;
        match b.status {
            s if s == Status::Verified as u8 => {
                require!(now >= b.challenge_ends, EscrowError::ChallengeWindowOpen);
                require!(b.payout_wallet != Pubkey::default(), EscrowError::NoWallet);
            }
            s if s == Status::Paid as u8 => {}
            _ => return err!(EscrowError::BadStatus),
        }
        require_keys_eq!(ctx.accounts.payout_wallet.key(), b.payout_wallet, EscrowError::BadWallet);
        let amount = move_pot(&ctx.accounts.bounty.to_account_info(), &ctx.accounts.payout_wallet)?;
        let b = &mut ctx.accounts.bounty;
        b.status = Status::Paid as u8;
        b.total_paid = b.total_paid.checked_add(amount).ok_or(EscrowError::Overflow)?;
        emit!(Released { bounty: b.key(), to: b.payout_wallet, amount });
        Ok(())
    }

    /// Permissionless. Deadline (+ grace) passed with no verified action: pot to the burn treasury.
    pub fn expire(ctx: Context<ToTreasury>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let b = &ctx.accounts.bounty;
        match b.status {
            s if s == Status::Open as u8 => require!(now > b.deadline + ctx.accounts.config.deadline_grace, EscrowError::NotExpired),
            s if s == Status::Expired as u8 || s == Status::OptedOut as u8 => {}
            _ => return err!(EscrowError::BadStatus),
        }
        let amount = move_pot(&ctx.accounts.bounty.to_account_info(), &ctx.accounts.treasury)?;
        let b = &mut ctx.accounts.bounty;
        if b.status == Status::Open as u8 {
            b.status = Status::Expired as u8;
        }
        emit!(Burned { bounty: b.key(), amount, status: b.status });
        Ok(())
    }

    /// 2 of 3 verifiers attest the target opted out of bounties: pot to the burn treasury.
    pub fn opt_out(ctx: Context<AttestToTreasury>, expiry: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &ctx.accounts.config;
        let b = &ctx.accounts.bounty;
        require!(b.status == Status::Open as u8, EscrowError::BadStatus);
        let msg = attestation_message(KIND_OPT_OUT, &b.key(), b.target_x_user_id, 0, &Pubkey::default(), expiry);
        check_attestation(&ctx.accounts.instructions, cfg, &msg, expiry, now)?;
        let amount = move_pot(&ctx.accounts.bounty.to_account_info(), &ctx.accounts.treasury)?;
        let b = &mut ctx.accounts.bounty;
        b.status = Status::OptedOut as u8;
        emit!(Burned { bounty: b.key(), amount, status: b.status });
        Ok(())
    }

    /// Admin: stop a payout during the challenge window (e.g. the account was hacked).
    pub fn freeze(ctx: Context<Admin>) -> Result<()> {
        let b = &mut ctx.accounts.bounty;
        require!(b.status == Status::Verified as u8, EscrowError::BadStatus);
        b.status = Status::Frozen as u8;
        emit!(StatusChanged { bounty: b.key(), status: b.status });
        Ok(())
    }

    /// Admin: false alarm. The challenge window starts again.
    pub fn unfreeze(ctx: Context<Admin>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let window = ctx.accounts.config.challenge_window;
        let b = &mut ctx.accounts.bounty;
        require!(b.status == Status::Frozen as u8, EscrowError::BadStatus);
        b.status = Status::Verified as u8;
        b.challenge_ends = now + window;
        emit!(StatusChanged { bounty: b.key(), status: b.status });
        Ok(())
    }

    /// Admin: the verification was wrong. The challenge reopens; the pot stays locked.
    pub fn cancel(ctx: Context<Admin>) -> Result<()> {
        let b = &mut ctx.accounts.bounty;
        require!(b.status == Status::Frozen as u8, EscrowError::BadStatus);
        b.status = Status::Open as u8;
        b.post_id = 0;
        b.payout_wallet = Pubkey::default();
        b.challenge_ends = 0;
        emit!(StatusChanged { bounty: b.key(), status: b.status });
        Ok(())
    }
}

/// The exact bytes verifiers sign. Mirrored in api/src/chain/attestation.ts.
pub fn attestation_message(kind: u8, bounty: &Pubkey, target: u64, post_id: u64, wallet: &Pubkey, expiry: i64) -> Vec<u8> {
    let mut m = Vec::with_capacity(ATTESTATION_LEN);
    m.extend_from_slice(ATTESTATION_PREFIX);
    m.push(kind);
    m.extend_from_slice(crate::ID.as_ref());
    m.extend_from_slice(bounty.as_ref());
    m.extend_from_slice(&target.to_le_bytes());
    m.extend_from_slice(&post_id.to_le_bytes());
    m.extend_from_slice(wallet.as_ref());
    m.extend_from_slice(&expiry.to_le_bytes());
    m
}

/// Counts distinct allowed verifiers that signed `msg` in ed25519 instructions placed before
/// this one in the same transaction. The ed25519 program has already checked the signatures
/// (the transaction fails otherwise); we check WHO signed and WHAT they signed.
fn check_attestation(ix_sysvar: &AccountInfo, cfg: &Config, msg: &[u8], expiry: i64, now: i64) -> Result<()> {
    require!(now <= expiry, EscrowError::AttestationExpired);
    let current = load_current_index_checked(ix_sysvar)? as usize;
    let mut signers: Vec<Pubkey> = Vec::with_capacity(3);
    for i in 0..current {
        let ix = load_instruction_at_checked(i, ix_sysvar)?;
        if ix.program_id != ED25519_PROGRAM_ID {
            continue;
        }
        for (pk, m) in parse_ed25519(&ix.data)? {
            if m == msg && cfg.verifiers.contains(&pk) && pk != Pubkey::default() && !signers.contains(&pk) {
                signers.push(pk);
            }
        }
    }
    require!(signers.len() >= cfg.threshold as usize, EscrowError::NotEnoughSignatures);
    Ok(())
}

/// Parses an ed25519 verify instruction. Only accepts data that lives inside the instruction
/// itself (instruction index u16::MAX), so nobody can point the check at other bytes.
fn parse_ed25519(data: &[u8]) -> Result<Vec<(Pubkey, &[u8])>> {
    require!(data.len() >= 2, EscrowError::BadEd25519);
    let n = data[0] as usize;
    let mut out = Vec::with_capacity(n);
    let u16_at = |o: usize| -> Result<usize> {
        let b = data.get(o..o + 2).ok_or(EscrowError::BadEd25519)?;
        Ok(u16::from_le_bytes([b[0], b[1]]) as usize)
    };
    for s in 0..n {
        let o = 2 + s * 14;
        let (sig_ix, pk_off, pk_ix, msg_off, msg_len, msg_ix) = (u16_at(o + 2)?, u16_at(o + 4)?, u16_at(o + 6)?, u16_at(o + 8)?, u16_at(o + 10)?, u16_at(o + 12)?);
        require!(sig_ix == 0xFFFF && pk_ix == 0xFFFF && msg_ix == 0xFFFF, EscrowError::BadEd25519);
        let pk = data.get(pk_off..pk_off + 32).ok_or(EscrowError::BadEd25519)?;
        let m = data.get(msg_off..msg_off + msg_len).ok_or(EscrowError::BadEd25519)?;
        out.push((Pubkey::try_from(pk).map_err(|_| EscrowError::BadEd25519)?, m));
    }
    Ok(out)
}

/// Moves everything above the rent-exempt minimum out of the bounty account.
fn move_pot<'a>(from: &AccountInfo<'a>, to: &AccountInfo<'a>) -> Result<u64> {
    let keep = Rent::get()?.minimum_balance(from.data_len());
    let amount = from.lamports().saturating_sub(keep);
    // An empty wallet can't receive less than its own rent minimum; leave dust for a later sweep.
    if to.lamports() == 0 && amount < Rent::get()?.minimum_balance(0) {
        return Ok(0);
    }
    if amount > 0 {
        **from.try_borrow_mut_lamports()? -= amount;
        **to.try_borrow_mut_lamports()? += amount;
    }
    Ok(amount)
}

// ---------- accounts ----------

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Main verifier, backup verifier (separate hosting), admin verifier key.
    pub verifiers: [Pubkey; 3],
    pub threshold: u8,
    pub challenge_window: i64,
    pub deadline_grace: i64,
    /// Receives expired / opted-out pots; the keeper buys the coin with them and burns it.
    pub treasury: Pubkey,
    /// Our Meteora DBC config key. Only pools created with it can get a bounty.
    pub dbc_config: Pubkey,
    pub bump: u8,
}

impl Config {
    fn apply(&mut self, a: &ConfigArgs) {
        self.verifiers = a.verifiers;
        self.threshold = a.threshold;
        self.challenge_window = a.challenge_window;
        self.deadline_grace = a.deadline_grace;
        self.treasury = a.treasury;
        self.dbc_config = a.dbc_config;
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigArgs {
    pub verifiers: [Pubkey; 3],
    pub threshold: u8,
    pub challenge_window: i64,
    pub deadline_grace: i64,
    pub treasury: Pubkey,
    pub dbc_config: Pubkey,
}

impl ConfigArgs {
    fn validate(&self) -> Result<()> {
        require!(self.threshold >= 2 && self.threshold <= 3, EscrowError::BadConfig);
        let v = &self.verifiers;
        require!(v[0] != v[1] && v[0] != v[2] && v[1] != v[2], EscrowError::BadConfig);
        require!(self.challenge_window >= 0 && self.deadline_grace >= 0, EscrowError::BadConfig);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub creator: Pubkey,
    pub target_x_user_id: u64,
    /// 0 cashtag, 1 contract address, 2 quote launch post, 3 video phrase
    pub action: u8,
    /// sha256 of the normalized phrase (video bounties), zero otherwise
    pub phrase_hash: [u8; 32],
    pub created_at: i64,
    pub deadline: i64,
    pub status: u8,
    pub post_id: u64,
    pub payout_wallet: Pubkey,
    pub challenge_ends: i64,
    pub total_deposited: u64,
    pub total_paid: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BountyArgs {
    pub target_x_user_id: u64,
    pub action: u8,
    pub phrase_hash: [u8; 32],
    pub deadline: i64,
}

#[repr(u8)]
pub enum Status {
    Open = 0,
    Verified = 1,
    Frozen = 2,
    Paid = 3,
    Expired = 4,
    OptedOut = 5,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateBounty<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = creator, space = 8 + Bounty::INIT_SPACE, seeds = [b"bounty", mint.key().as_ref()], bump)]
    pub bounty: Account<'info, Bounty>,
    /// CHECK: the coin's mint; must equal the pool's base mint (checked in the handler).
    pub mint: UncheckedAccount<'info>,
    /// CHECK: Meteora VirtualPool; owner, discriminator and fields checked in the handler.
    pub pool: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"bounty", bounty.mint.as_ref()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Attest<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"bounty", bounty.mint.as_ref()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    /// CHECK: the instructions sysvar (address checked).
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AttestToTreasury<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = treasury)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"bounty", bounty.mint.as_ref()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    /// CHECK: the instructions sysvar (address checked).
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    /// CHECK: must equal config.treasury (has_one).
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut, seeds = [b"bounty", bounty.mint.as_ref()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    /// CHECK: must equal bounty.payout_wallet (checked in the handler).
    #[account(mut)]
    pub payout_wallet: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ToTreasury<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = treasury)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"bounty", bounty.mint.as_ref()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    /// CHECK: must equal config.treasury (has_one).
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"bounty", bounty.mint.as_ref()], bump = bounty.bump)]
    pub bounty: Account<'info, Bounty>,
    pub admin: Signer<'info>,
}

// ---------- events ----------

#[event]
pub struct BountyCreated { pub bounty: Pubkey, pub mint: Pubkey, pub target_x_user_id: u64, pub action: u8, pub deadline: i64 }
#[event]
pub struct Deposited { pub bounty: Pubkey, pub amount: u64, pub total: u64 }
#[event]
pub struct Verified { pub bounty: Pubkey, pub post_id: u64, pub payout_wallet: Pubkey, pub challenge_ends: i64 }
#[event]
pub struct WalletAssigned { pub bounty: Pubkey, pub payout_wallet: Pubkey }
#[event]
pub struct Released { pub bounty: Pubkey, pub to: Pubkey, pub amount: u64 }
#[event]
pub struct Burned { pub bounty: Pubkey, pub amount: u64, pub status: u8 }
#[event]
pub struct StatusChanged { pub bounty: Pubkey, pub status: u8 }

#[error_code]
pub enum EscrowError {
    #[msg("Unknown bounty action")] BadAction,
    #[msg("Missing X user id")] BadTarget,
    #[msg("Deadline must be in the future and within a year")] BadDeadline,
    #[msg("Not a Meteora bonding curve pool")] NotDbcPool,
    #[msg("Pool was not created on Bounty Pad")] WrongLaunchpad,
    #[msg("Pool is for a different mint")] WrongMint,
    #[msg("Pool was created by a different wallet")] WrongCreator,
    #[msg("Amount must be above zero")] ZeroAmount,
    #[msg("Not allowed in the bounty's current status")] BadStatus,
    #[msg("The bounty deadline has passed")] DeadlinePassed,
    #[msg("Missing post id")] BadPost,
    #[msg("Invalid payout wallet")] BadWallet,
    #[msg("No payout wallet yet")] NoWallet,
    #[msg("The challenge window is still open")] ChallengeWindowOpen,
    #[msg("The deadline (plus grace) hasn't passed")] NotExpired,
    #[msg("Attestation expired")] AttestationExpired,
    #[msg("Not enough verifier signatures")] NotEnoughSignatures,
    #[msg("Malformed ed25519 instruction")] BadEd25519,
    #[msg("Invalid config")] BadConfig,
    #[msg("Math overflow")] Overflow,
}
