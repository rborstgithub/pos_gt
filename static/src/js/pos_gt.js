odoo.define('pos_gt.pos_gt', function (require) {
"use strict";

var screens = require('point_of_sale.screens');
var models = require('point_of_sale.models');
var pos_db = require('point_of_sale.DB');
var core = require('web.core');
var gui = require('point_of_sale.gui');
var Model = require('web.DataModel');
var _t = core._t;

var orden_id_cargada = 0;
models.load_models({
    model: 'account.journal',
    fields: [],
    domain: function(self){ return [['id','=',self.config.journal_id[0]]]; },
    loaded: function(self,journals){
        if (journals.length > 0) {
            self.sale_journal = journals[0];
        }
    },
});

models.load_models({
    model: 'res.partner',
    fields: [],
    domain: function(self){ return [['id','=',self.sale_journal.direccion[0]]]; },
    condition: function(self){ return self.sale_journal.direccion; },
    loaded: function(self,addresses){
        if (addresses.length > 0) {
            self.sale_journal_address = addresses[0];
        }
    },
});

models.load_fields('product.product','extras_id');

models.load_models({
    model: 'pos_gt.extra',
    fields: [],
    loaded: function(self,extras){
        var extras_by_id = {};
        extras.forEach(function(e) {
            extras_by_id[e.id] = e
        })
        self.product_extras = extras_by_id;
    },
});

models.load_models({
    model: 'pos_gt.extra.line',
    fields: [],
    loaded: function(self,extra_lines){
        var extra_lines_by_id = {};
        extra_lines.forEach(function(e) {
            if (!(e.extra_id[0] in extra_lines_by_id)) {
                extra_lines_by_id[e.extra_id[0]] = []
            }
            extra_lines_by_id[e.extra_id[0]].push(e)
        })
        self.product_extra_lines = extra_lines_by_id;
    },
});

screens.ProductCategoriesWidget.include({
    set_category : function(category) {
        var db = this.pos.db;
        if (!category) {
            category = db.get_category_by_id(this.start_categ_id);
        }
        this._super(category);
    }
})

screens.ClientListScreenWidget.include({
        show: function(){
            var self = this;
            var nit = '';
            this._super();
            this.$('.new-customer').click(function(){
                nit = self.$('.searchbox input')[0].value
                self.display_client_details('edit',{
                    'vat': nit,
                });
            });
        },
});

var TagNumberButton = screens.ActionButtonWidget.extend({
    template: 'TagNumberButton',
    init: function(parent, options) {
        this._super(parent, options);
        this.pos.bind('change:selectedOrder',this.renderElement,this);
    },
    button_click: function(){
        var self = this;
        var order = this.pos.get_order();
        this.gui.show_popup('number',{
            'title': 'Etiqueta',
            'value': 1,
            'confirm': function(val) {
                order.tag_number = val;
                self.renderElement();
            },
        });
    },
});

screens.define_action_button({
    'name': 'tag_number',
    'widget': TagNumberButton,
    'condition': function(){
        return this.pos.config.ask_tag_number;
    },
});

var TakeOutButton = screens.ActionButtonWidget.extend({
    template: 'TakeOutButton',
    init: function(parent, options) {
        this._super(parent, options);
        this.pos.bind('change:selectedOrder',this.renderElement,this);
    },
    button_click: function(){
        var self = this;
        var order = this.pos.get_order();
        order.take_out = !order.take_out;
        this.renderElement();
    },
});

screens.define_action_button({
    'name': 'take_out',
    'widget': TakeOutButton,
    'condition': function(){
        return this.pos.config.takeout_option;
    },
});

var RecetasButton = screens.ActionButtonWidget.extend({
    template: 'RecetasButton',
    init: function(parent, options) {
        this._super(parent, options);
        this.pos.bind('change:selectedOrder',this.renderElement,this);
    },
    button_click: function(){
        var self = this;
        var order = this.pos.get_order();
        var Producto = new Model('product.template');
        var Receta = new Model('mrp.bom');
        var producto = order.get_selected_orderline().product.product_tmpl_id;
        Receta.query(['id','product_tmpl_id','code'])
         .filter([['product_tmpl_id', '=', producto]])
         .limit(1000)
         .all().then(function (receta) {
            if(receta.length > 0){
                var ProductosRecetas = new Model('mrp.bom.line');
                ProductosRecetas.query(['id','product_id','product_uom_id','product_qty'])
                     .filter([['bom_id', '=', receta[0].id]])
                     .limit(1000)
                     .all().then(function (receta) {
                        for (var i=0; i < receta.length; i++){
                            receta[i]['label'] = receta[i].product_id[1] +' '+ 'Cantidad: '+receta[i].product_qty+ ' ' +receta[i].product_uom_id[1]
                            receta[i]['item'] = receta[i].id
                        }
                        self.mostrar_receta(receta);
                });
            }

        });
        order.recetas = !order.recetas;
        this.renderElement();
    },

    mostrar_receta: function(productos){
        var self = this;
        var order = this.pos.get_order();
        var producto = order.get_selected_orderline().product.display_name;
        this.gui.show_popup('selection', {
            'title': producto + ' Receta Unitaria',
            'list': productos,
            'confirm': function(producto) {
            },
        });
    },
});

screens.define_action_button({
    'name': 'recetas',
    'widget': RecetasButton,
    'condition': function(){
        return this.pos.config.opcion_recetas;
    },
});

screens.ClientListScreenWidget.include({
    display_client_details: function(visibility,partner,clickpos){
        this._super(visibility,partner,clickpos);
        if (visibility === 'edit') {
            var vat = this.$('.screen-content input').val();
            if (this.$('.vat').val().trim() == '') {
                this.$('.vat').val(vat);
            }
        };
    }
})

screens.PaymentScreenWidget.include({
    show: function(){
        if (!this.pos.get_order().is_to_invoice()) {
            this.click_invoice();
        }
        this._super();
    }
})

var _super_posmodel = models.PosModel.prototype;
models.PosModel = models.PosModel.extend({
    add_new_order: function(){
        var new_order = _super_posmodel.add_new_order.apply(this);
        if (this.config.default_client_id) {
            new_order.set_client(this.db.get_partner_by_id(this.config.default_client_id[0]))
        }
    }
})

var _super_order = models.Order.prototype;
models.Order = models.Order.extend({
    add_product: function(product, options) {
        options = options || {};

        function show_extras_popup(current_list) {

            if (gui.has_popup()) {
                setTimeout(function(){
                    show_extras_popup(current_list)
                }, 800)
                return;
            }

            var list = current_list.pop();
            if (list) {
                gui.show_popup('selection', {
                    'title': 'Extras',
                    'list': list,
                    'confirm': function(line) {
                        var extra_product = db.get_product_by_id(line.product_id[0]);
                        extra_product.lst_price = line.price_extra;
                        order.add_product(extra_product, { price: line.price_extra, quantity: line.qty, extras: { extra_type: line.type, parent_line: new_line} });
                        show_extras_popup(current_list);
                    },
                    'cancel': function(line) {
                        show_extras_popup(current_list);
                    },
                });
            }
        }

        options.merge = false;
        _super_order.add_product.apply(this, [product, options]);

        var new_line = this.get_last_orderline();
        var order = this.pos.get_order();
        var db = this.pos.db;
        var gui = this.pos.gui;
        var chrome = this.pos.chrome;
        var extras_db = this.pos.product_extras;
        var extra_lines_db = this.pos.product_extra_lines;

        if (options.cargar_extras || options.cargar_extras == null) {
            if (product.extras_id && product.extras_id.length > 0) {
                var extra_lists = [];
                product.extras_id.forEach(function(extra_id) {
                    var extra = extras_db[extra_id];
                    var extra_lines = extra_lines_db[extra_id];

                    if (extra_lines) {
                        var list = []
                        extra_lines.forEach(function(line) {
                            line.type = extra.type;
                            list.push({
                                label: line.name + " ( "+line.qty+" ) - " + chrome.format_currency(line.price_extra),
                                item: line,
                            });
                        })
                        extra_lists.push(list);
                    }
                })

                show_extras_popup(extra_lists);
            }
        }
    }
})

var _super_line = models.Orderline.prototype;
models.Orderline = models.Orderline.extend({
    set_quantity: function(quantity){
        var line = this;
        var order = this.pos.get_order();

        if (line && order) {

            // Si se trata de modificar la linea extra y esta no se puede modificar
            if (line.extra_type && line.extra_type == "fixed") {

                this.pos.gui.show_popup("error",{
                    "title": "Parte de combo",
                    "body":  "Esta linea no se puede modificar por que es parte de un combo, solo se puede borrar todo el combo borrando la linea principal.",
                });

            } else {

                var to_remove = [];
                order.get_orderlines().forEach(function(l) {
                    if (l.parent_line && l.parent_line.id == line.id) {
                        to_remove.push(l);
                    }
                });

                // Si se trata de modificar una linea padre, se borra.
                if (to_remove.length > 0) {
                    to_remove.forEach(function(l) {
                        order.remove_orderline(l);
                    });
                    order.remove_orderline(line);
                } else {
                    _super_line.set_quantity.apply(this,arguments);
                }

            }
        } else {
            _super_line.set_quantity.apply(this,arguments);
        }
    }
})

pos_db.include({
    _partner_search_string: function(partner){
        var str =  partner.name;
        if(partner.ean13){
            str += '|' + partner.ean13;
        }
        if(partner.address){
            str += '|' + partner.address;
        }
        if(partner.phone){
            str += '|' + partner.phone.split(' ').join('');
        }
        if(partner.mobile){
            str += '|' + partner.mobile.split(' ').join('');
        }
        if(partner.email){
            str += '|' + partner.email;
        }
        if(partner.vat){
            str += '|' + partner.vat;
        }
        str = '' + partner.id + ':' + str.replace(':','') + '\n';
        return str;
    }
})

});
