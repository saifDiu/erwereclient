from odoo import fields, models, api, tools


class FreeWebmailDomain(models.Model):
    _name = 'ms_customer.free_webmail_domain'
    _description = 'Free Webmail Domain'
    _order = 'name'

    name = fields.Char(string='Domain', required=True, help="Lowercase domain, e.g. gmail.com")
    active = fields.Boolean(default=True)

    _sql_constraints = [
        ('name_uniq', 'unique(name)', 'This domain is already in the free webmail list.'),
    ]

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name'):
                vals['name'] = vals['name'].strip().lower()
        records = super().create(vals_list)
        self.env.registry.clear_cache()
        return records

    def write(self, vals):
        if 'name' in vals and vals['name']:
            vals['name'] = vals['name'].strip().lower()
        result = super().write(vals)
        self.env.registry.clear_cache()
        return result

    def unlink(self):
        result = super().unlink()
        self.env.registry.clear_cache()
        return result

    @api.model
    @tools.ormcache()
    def _get_free_domains(self):
        """Cached set of active free webmail domains."""
        rows = self.search_read([('active', '=', True)], ['name'])
        return frozenset(r['name'] for r in rows)
