var _ = require('underscore');
var Firebase = require('firebase');
var async=require('async')
 
var get_barcode_list = function (firebase_url,callback) {
    try {

async.waterfall([
    function(callback) {
       var rootref = new Firebase(firebase_url);
    rootref.once("value", function (ctrlctr_data) {
            var ctrlctr_data = ctrlctr_data.val();
            var purchase_order_array = []
            for (var res_id in ctrlctr_data) {
                var restaurant_id = res_id;
                var restaurant_data = ctrlctr_data[restaurant_id];
                purchase_order_array.push( {restaurant_id: restaurant_id, restaurant_data:restaurant_data})
            }
callback(null, purchase_order_array, restaurant_id)
        })
    },
    function(purchase_order_array,restaurant_id, callback) {
       var item_array = []

_.map(purchase_order_array, function (item) {
    for (var po_id in item.restaurant_data) {
        var poid = po_id
        var item_data = item.restaurant_data[poid]
        _.map(_.pluck(item_data, 'barcodes'), function (barcode) {
           item_array.push({ restaurant_id: item.restaurant_id,po_id:poid, barcode: barcode })
        })
    }
})
    callback(null, item_array); 
    },
    function(item_array, callback) {
        var restaurant_barcodes_array=[]
_.map(item_array,function(key){
var res_id=key.restaurant_id
var po_id=key.po_id;
    for (var bar_key in key.barcode) {
                            var values = { restaurant_id: res_id,po_id:po_id, barcode: key.barcode[bar_key] }
                            restaurant_barcodes_array.push(values);
                    } 
    })
   callback(null, restaurant_barcodes_array);
    }
], function (err, result) {
    if(err){
        return callback(new Error(err))
    }
     return callback(null, result)
});
      
    } catch (ex) {
        return callback(new Error(ex))
    }
}

module.exports = {
    get_barcode_list: get_barcode_list
}