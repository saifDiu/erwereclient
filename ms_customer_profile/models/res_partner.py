from odoo import api, fields, models, tools, _
from odoo.exceptions import UserError


class ResPartner(models.Model):
    _name = 'res.partner'
    _inherit = ['res.partner', 'portal.mixin']

    account_type = fields.Selection(
        [('end_customer', 'End Customer'), ('reseller', 'Reseller')],
        string='Account Type', tracking=True, index=True)

    is_blocked = fields.Boolean(
        string='Blocked', default=False, copy=False, tracking=True,
        help="A blocked customer cannot place new orders or receive new quotes.")
    block_reason = fields.Char(string='Block Reason', tracking=True)
    block_history_ids = fields.One2many(
        'ms_customer.block_history', 'partner_id', string='Block History')

    email_domain = fields.Char(
        string='Email Domain', compute='_compute_email_domain',
        store=True, index=True)
    is_free_webmail = fields.Boolean(
        string='Free Webmail', compute='_compute_email_domain', store=True,
        help="True when the email belongs to a free webmail provider (Gmail, Hotmail, etc).")

    portal_super_link = fields.Char(
        string='Portal Super Link', compute='_compute_portal_super_link',
        help="Personal portal link for this customer. Click 'Generate Super Link' if empty.")

    @api.depends('email')
    def _compute_email_domain(self):
        free_domains = self.env['ms_customer.free_webmail_domain'].sudo()._get_free_domains()
        for partner in self:
            normalized = tools.email_normalize(partner.email) if partner.email else False
            domain = normalized.split('@', 1)[1].lower() if normalized and '@' in normalized else False
            partner.email_domain = domain
            partner.is_free_webmail = bool(domain and domain in free_domains)

    def _compute_access_url(self):
        super()._compute_access_url()
        for partner in self:
            if partner.id:
                partner.access_url = '/customer/profile/%s' % partner.id

    def _compute_portal_super_link(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '')
        for partner in self:
            if partner.id and partner.access_token:
                partner.portal_super_link = '%s/customer/profile/%s?access_token=%s' % (
                    base_url, partner.id, partner.access_token)
            else:
                partner.portal_super_link = False

    def action_generate_super_link(self):
        for partner in self:
            partner.sudo()._portal_ensure_token()
        return True

    @api.model_create_multi
    def create(self, vals_list):
        partners = super().create(vals_list)
        partners._auto_link_company_by_domain()
        return partners

    def write(self, vals):
        prev_blocked = {p.id: p.is_blocked for p in self} if 'is_blocked' in vals else {}
        result = super().write(vals)
        if 'email' in vals:
            self._auto_link_company_by_domain()
        if 'is_blocked' in vals:
            for partner in self:
                if prev_blocked.get(partner.id) != partner.is_blocked:
                    self.env['ms_customer.block_history'].sudo().create({
                        'partner_id': partner.id,
                        'action': 'block' if partner.is_blocked else 'unblock',
                        'reason': partner.block_reason or False,
                    })
        return result

    def _auto_link_company_by_domain(self):
        """When a contact has a non-free company email and no parent yet,
        try to attach it to the first existing company partner sharing the
        same email domain. Silent and idempotent."""
        for partner in self:
            if partner.parent_id or partner.is_company:
                continue
            if not partner.email_domain or partner.is_free_webmail:
                continue
            company = self.sudo().search([
                ('id', '!=', partner.id),
                ('is_company', '=', True),
                ('email_domain', '=', partner.email_domain),
            ], limit=1)
            if company:
                partner.with_context(skip_auto_link=True).parent_id = company.id

    def action_block_customer(self):
        for partner in self:
            partner.is_blocked = True

    def action_unblock_customer(self):
        for partner in self:
            partner.is_blocked = False

    def action_open_super_link(self):
        self.ensure_one()
        token = self.sudo()._portal_ensure_token()
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '')
        url = '%s/customer/profile/%s?access_token=%s' % (base_url, self.id, token)
        return {
            'type': 'ir.actions.act_url',
            'url': url,
            'target': 'new',
        }

    def action_view_related_contacts(self):
        """Open all partners sharing the same email domain (excluding free webmail)."""
        self.ensure_one()
        if not self.email_domain or self.is_free_webmail:
            raise UserError(_("No company domain available for this contact."))
        return {
            'type': 'ir.actions.act_window',
            'name': _('Related Contacts (%s)', self.email_domain),
            'res_model': 'res.partner',
            'view_mode': 'list,form',
            'domain': [('email_domain', '=', self.email_domain), ('id', '!=', self.id)],
        }
