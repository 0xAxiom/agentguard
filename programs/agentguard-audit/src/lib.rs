use anchor_lang::prelude::*;

declare_id!("9iCre3TbvPbgmV2RmviiUtCuNiNeQa9cphSABPpkGSdR");

/// AgentGuard On-Chain Audit Trail
///
/// Provides immutable, verifiable security event logging for AI agents.
/// Every firewall block, injection attempt, and secret leak is recorded
/// on-chain for full transparency and accountability.
///
/// Architecture:
///   Agent Wallet → AuditAuthority PDA → SecurityEvent PDAs
///
/// Anyone can read events. Only the authority can write them.
#[program]
pub mod agentguard_audit {
    use super::*;

    /// Initialize an audit authority for an agent.
    /// Creates a PDA that tracks the agent's security event count.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let authority = &mut ctx.accounts.audit_authority;
        authority.authority = ctx.accounts.signer.key();
        authority.event_count = 0;
        authority.created_at = Clock::get()?.unix_timestamp;
        authority.bump = ctx.bumps.audit_authority;

        emit!(AuditInitialized {
            authority: ctx.accounts.signer.key(),
            timestamp: authority.created_at,
        });

        msg!("AgentGuard: Audit authority initialized for {}", ctx.accounts.signer.key());
        Ok(())
    }

    /// Log a security event on-chain.
    ///
    /// Event types:
    ///   0 = Transaction check (firewall)
    ///   1 = Prompt injection detected (sanitizer)
    ///   2 = Secret leak caught (isolator)
    ///   3 = General action logged
    ///
    /// The action_hash is a SHA-256 of the full event details,
    /// allowing off-chain verification without storing sensitive data on-chain.
    pub fn log_event(
        ctx: Context<LogEvent>,
        event_type: u8,
        action_hash: [u8; 32],
        allowed: bool,
        details_len: u16,
    ) -> Result<()> {
        require!(event_type <= 3, AgentGuardError::InvalidEventType);

        let authority = &mut ctx.accounts.audit_authority;
        let event = &mut ctx.accounts.security_event;
        let now = Clock::get()?.unix_timestamp;

        event.authority = authority.authority;
        event.event_type = event_type;
        event.action_hash = action_hash;
        event.allowed = allowed;
        event.timestamp = now;
        event.event_index = authority.event_count;
        event.details_len = details_len;
        event.bump = ctx.bumps.security_event;

        authority.event_count = authority.event_count.checked_add(1)
            .ok_or(AgentGuardError::EventCountOverflow)?;

        emit!(SecurityEventLogged {
            authority: authority.authority,
            event_index: event.event_index,
            event_type,
            allowed,
            action_hash,
            timestamp: now,
        });

        msg!(
            "AgentGuard: Event #{} type={} allowed={} for {}",
            event.event_index,
            event_type,
            allowed,
            authority.authority
        );

        Ok(())
    }

    /// Close a security event account to reclaim rent.
    /// Only the authority can close their own events.
    pub fn close_event(ctx: Context<CloseEvent>) -> Result<()> {
        emit!(SecurityEventClosed {
            authority: ctx.accounts.audit_authority.authority,
            event_index: ctx.accounts.security_event.event_index,
        });

        msg!(
            "AgentGuard: Event #{} closed, rent reclaimed",
            ctx.accounts.security_event.event_index
        );

        Ok(())
    }
}

// ============================================================
// Accounts
// ============================================================

#[account]
#[derive(Default)]
pub struct AuditAuthority {
    /// The agent wallet that owns this audit trail
    pub authority: Pubkey,
    /// Total number of security events logged
    pub event_count: u64,
    /// When this authority was initialized
    pub created_at: i64,
    /// PDA bump seed
    pub bump: u8,
}

impl AuditAuthority {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1; // discriminator + fields
}

#[account]
#[derive(Default)]
pub struct SecurityEvent {
    /// Which agent logged this event
    pub authority: Pubkey,
    /// Event type: 0=tx_check, 1=injection, 2=secret_leak, 3=action
    pub event_type: u8,
    /// SHA-256 hash of the full event details (for off-chain verification)
    pub action_hash: [u8; 32],
    /// Whether the action was allowed or blocked
    pub allowed: bool,
    /// Unix timestamp of the event
    pub timestamp: i64,
    /// Sequential event index for this authority
    pub event_index: u64,
    /// Length of off-chain details (for reference)
    pub details_len: u16,
    /// PDA bump seed
    pub bump: u8,
}

impl SecurityEvent {
    pub const LEN: usize = 8 + 32 + 1 + 32 + 1 + 8 + 8 + 2 + 1; // discriminator + fields
}

// ============================================================
// Instructions
// ============================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = signer,
        space = AuditAuthority::LEN,
        seeds = [b"audit-authority", signer.key().as_ref()],
        bump
    )]
    pub audit_authority: Account<'info, AuditAuthority>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LogEvent<'info> {
    #[account(
        mut,
        seeds = [b"audit-authority", signer.key().as_ref()],
        bump = audit_authority.bump,
    )]
    pub audit_authority: Account<'info, AuditAuthority>,

    #[account(
        init,
        payer = signer,
        space = SecurityEvent::LEN,
        seeds = [
            b"security-event",
            signer.key().as_ref(),
            audit_authority.event_count.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub security_event: Account<'info, SecurityEvent>,

    #[account(
        mut,
        constraint = audit_authority.authority == signer.key() @ AgentGuardError::UnauthorizedSigner
    )]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseEvent<'info> {
    #[account(
        seeds = [b"audit-authority", signer.key().as_ref()],
        bump = audit_authority.bump,
    )]
    pub audit_authority: Account<'info, AuditAuthority>,

    #[account(
        mut,
        close = signer,
        seeds = [
            b"security-event",
            signer.key().as_ref(),
            security_event.event_index.to_le_bytes().as_ref()
        ],
        bump = security_event.bump,
        constraint = security_event.authority == signer.key()
            @ AgentGuardError::UnauthorizedSigner,
    )]
    pub security_event: Account<'info, SecurityEvent>,

    #[account(
        mut,
        constraint = audit_authority.authority == signer.key() @ AgentGuardError::UnauthorizedSigner
    )]
    pub signer: Signer<'info>,
}

// ============================================================
// Events (for indexing)
// ============================================================

#[event]
pub struct AuditInitialized {
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SecurityEventLogged {
    pub authority: Pubkey,
    pub event_index: u64,
    pub event_type: u8,
    pub allowed: bool,
    pub action_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct SecurityEventClosed {
    pub authority: Pubkey,
    pub event_index: u64,
}

// ============================================================
// Errors
// ============================================================

#[error_code]
pub enum AgentGuardError {
    #[msg("Invalid event type. Must be 0-3.")]
    InvalidEventType,

    #[msg("Only the audit authority owner can log events.")]
    UnauthorizedSigner,

    #[msg("Event count overflow.")]
    EventCountOverflow,
}
