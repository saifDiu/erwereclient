from odoo import fields, models


class CustomerBlockHistory(models.Model):
    _name = 'ms_customer.block_history'
    _description = 'Customer Block / Unblock Audit Trail'
    _order = 'date desc, id desc'
    _rec_name = 'partner_id'

    partner_id = fields.Many2one(
        'res.partner', string='Customer', required=True,
        ondelete='cascade', index=True)
    action = fields.Selection(
        [('block', 'Blocked'), ('unblock', 'Unblocked')],
        string='Action', required=True)
    reason = fields.Char(string='Reason')
    user_id = fields.Many2one(
        'res.users', string='Performed By',
        default=lambda self: self.env.user, required=True)
    date = fields.Datetime(
        string='Date', default=fields.Datetime.now, required=True)
