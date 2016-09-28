var _ = require('underscore');
var pg = require('pg');
var async = require('async');
var moment = require('moment');

var config = require('../models/config');
var conString = config.dbConn;
var format = require('string-format');
format.extend(String.prototype);
var Firebase = require('firebase');
var barcode_list = require('../models/get_barcodes_list');

var get_barcode_list_from_firebase = function (firebase_url,restaurant_id,callback) {

    barcode_list.get_barcode_list(firebase_url, function (err, response) {
        if (err) {
            return callback(new Error(err, null));
        }
        if (response) {
pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(new Error(err, null));
        }

var query_string="select ordered.restaurant_id,ordered.outlet_id,ordered.orderedqty,pckd.pkdquantity,\
owl.name as outletname,owl.short_name as outlet_short_name,r.name as restaurant_name,r.short_name as restaurant_short_name,r.entity ,ordered.session_name from ( \
with barcodes as (select x.barlist->>'restaurant_id' as restaurant_id,x.barlist->>'barcode' as barcode , x.barlist->>'po_id' as po_id \
 from( select json_array_elements($1) as barlist  ) as x where substr(x.barlist->>'barcode',13,8)=to_char(now(),'DDMMYYYY') ) \
select \
coalesce(grpd.restaurant_id,batchdata.restaurant_id) as restaurant_id, \
coalesce(grpd.outlet_id,batchdata.outlet_id) as outlet_id, \
coalesce(grpd.po_id::int,batchdata.purchase_order_id::int) as purchase_order_id, \
coalesce(grpd.fbqty,batchdata.batchqty) as pkdquantity \
from (select restaurant_id::int as restaurant_id,substr(barcode,3,3)::int as outlet_id ,po_id, \
  count(barcode) as fbqty from barcodes  group by \
 restaurant_id,substr(barcode,3,3)::int,po_id) as grpd \
full outer join \
 (select  p.restaurant_id,p.outlet_id as outlet_id ,p.id as purchase_order_id,sum(quantity) as batchqty \
from purchase_order_batch b join purchase_order p \
  on b.purchase_order_id=p.id \
where scheduled_delivery_time::date=current_date \
group by p.restaurant_id, p.outlet_id,p.id ) as batchdata \
   on grpd.restaurant_id=batchdata.restaurant_id and grpd.outlet_id=batchdata.outlet_id \
) as pckd  \
right outer join ( select p.restaurant_id,p.outlet_id , p.id as purchase_order_id, sum(pm.quantity) as orderedqty,m.name as session_name from purchase_order p join purchase_order_master_list pm \
on p.id=pm.purchase_order_id join menu_bands m  on \
p.outlet_id=m.outlet_id where \
scheduled_delivery_time::date=now()::Date \
and now()::time \
between m.start_time and m.end_time  and \
scheduled_delivery_time::time between m.start_time and m.end_time \
group by p.restaurant_id,p.outlet_id,m.name,p.id )  as ordered \
on pckd.restaurant_id=ordered.restaurant_id and pckd.outlet_id=ordered.outlet_id and pckd.purchase_order_id=ordered.purchase_order_id join outlet owl on ordered.outlet_id=owl.id \
join restaurant r on ordered.restaurant_id=r.id \
where (case when coalesce($2,ordered.restaurant_id)=$2 then $2 else ordered.restaurant_id end) = ordered.restaurant_id "

client.query(query_string,
            [JSON.stringify(response),restaurant_id],
            function (query_err, restaurant) {
                done();
                if (query_err) {
                    return callback(new Error(query_err, null));
                }
                if (restaurant.rows.length > 0) {
                    return callback(null, restaurant.rows);
                } else {
                    return callback(new Error("No data found"));
                }
            });
})
        }else {
                    return callback(new Error("No data found"));
                }
    })
}


var get_live_packing_data = function (restaurant_id, firebase_url, callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(new Error(err, null));
        }
        client.query(
            "select sum(polist.quantity) as total_quantity,po.session_name,po.id from purchase_order  po \
            inner join purchase_order_master_list polist on polist.purchase_order_id=po.id \
            where po.restaurant_id=$1 and po.scheduled_delivery_time::date=now()::date \
            group by po.session_name,po.id",
            [restaurant_id],
            function (query_err, total_live_count) {
                done();
                if (query_err) {
                    return callback(new Error(query_err, null));
                }
                if (total_live_count.rows.length > 0) {
                    var total_quantity = 0;
                    _.map(total_live_count.rows, function (item) {
                        total_quantity += parseInt(item.total_quantity)
                    })

                    var rootref = new Firebase(firebase_url);
                    var overall_packed = 0
                    var live_packing_data = rootref.child('{}/'.format(restaurant_id));
                    var item_data = [];
                    // Getting the stock data
                    live_packing_data.once("value", function (data) {
                        var data = data.val();
                        var session_wise_details = [];
                        for (var key in data) {
                            var session_wise_packed = 0;
                            var current_po = _.where(total_live_count.rows, { id: parseInt(key) });
                            if (current_po[0] != undefined) {
                                var po_id = key;
                                var val = data[key];
                                _.map(_.pluck(val, 'barcodes'), function (barcode) {
                                    session_wise_packed += Object.keys(barcode).length;
                                })
                                overall_packed += session_wise_packed
                                session_unpacked = current_po[0].total_quantity - session_wise_packed
                                session_wise_details.push({ po_id: po_id, session: current_po[0].session_name, total_packed: session_wise_packed, session_unpacked: session_unpacked })
                            }
                        }

                        var unpacked = total_quantity - overall_packed;
                        var context = { overall_packed: overall_packed, unpacked: unpacked, session_wise_details: session_wise_details }
                        return callback(null, context);
                    });
                } else {
                    return callback(new Error("No data found"));
                }
            }
        );
    });
}

var get_session_data = function (restaurant_id, callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(new Error(err, null));
        }
        client.query(
            "select sum(vpa.qty)::numeric as qty, trim(fi.name) as name,vpa.session \
from volume_plan_automation vpa \
inner join food_item fi on fi.id=vpa.food_item_id \
inner join session ses on ses.name=vpa.session \
where vpa.restaurant_id = $1 and vpa.date = current_date \
group by  trim(fi.name),vpa.session,ses.sequence \
order by ses.sequence",
            [restaurant_id],
            function (query_err, restaurant) {
                done();
                if (query_err) {
                    return callback(new Error(query_err, null));
                }
                if (restaurant.rows.length > 0) {
                    return callback(null, restaurant.rows);
                } else {
                    return callback(new Error("No data found"));
                }
            }
        );
    });
};

var initial_seed_data_signup = function (callback) {
    async.parallel({
        city: function (callback) {
            config.query('select short_name ,name from city',
                [],
                function (err, result) {
                    if (err) {
                        return callback('error running query' + err, null)
                    }
                    callback(null, result.rows)
                })
        },

        restaurant: function (callback) {
            config.query('select distinct res.id,res.name as name,res.short_name,rcon.sender_email as mail_id,out.city as city from restaurant res \
                        inner join food_item fi on fi.restaurant_id=res.id \
                        inner join outlet out on out.id=fi.outlet_id \
                        inner join restaurant_config rcon on rcon.restaurant_id=res.id \
                        where res.id>0 order by res.name',
                [],
                function (err, result) {
                    if (err) {
                        callback('error running query' + err, null)
                        return
                    }
                    return callback(null, result.rows)
                })
        }
    },

        function (err, results) {
            if (err) {
                return callback(new Error('Sign up ' + err))
            }
            return callback(null, results)
        })
}

var get_random_pin = function (callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(new Error('error fetching client from pool' + err))
        }
        client.query('select alphanumeric_generator(4)',
            [],
            function (query_err, pin_result) {
                done();
                if (query_err) {
                    return callback(new Error('error running query' + query_err))
                }
                if (pin_result.rows[0]) {
                    return callback(null, pin_result.rows[0])
                } else {
                    return callback(new Error('No pin found'))
                }
            })
    })
}

var update_pin_to_restaurant = function (mpin, restaurant_id, callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(new Error('error fetching client from pool' + err))
        }
        client.query('update restaurant_config set mpin=$1 where restaurant_id=$2',
            [mpin, restaurant_id],
            function (query_err, pin_result) {
                done();
                if (query_err) {
                    return callback(new Error('error running query' + query_err))
                }
                if (pin_result) {
                    return callback(null, 'Successfully inserted')
                } else {
                    return callback(new Error('Unexpected error occured while updating entries'))
                }
            })
    })
}

var check_credentials = function (mpin, callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(new Error('error fetching client from pool' + err))
        }
        client.query('select res.name,res.id,res.short_name,rcon.firebase_url from restaurant res \
                inner join restaurant_config rcon on rcon.restaurant_id=res.id where rcon.mpin=$1',
            [mpin],
            function (query_err, pin_result) {
                done();
                if (query_err) {
                    return callback(new Error('error running query' + query_err))
                }
                if (pin_result.rows[0]) {
                    return callback(null, pin_result.rows[0])
                } else {
                    return callback(new Error('No data found'))
                }
            })
    })
}


var get_sales_data = function (restaurant_id, callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(err, null)
        }
        client.query('select sum(batch.quantity) as taken from purchase_order po \
                     inner join purchase_order_batch batch on batch.purchase_order_id=po.id \
                    where po.restaurant_id=$1 and batch.received_time::date=now()::date'
            , [restaurant_id],
            function (query_err, taken_result) {
                done();
                if (query_err) {
                    return callback(query_err, null)
                }
                if (taken_result) {
                    client.query(
                        "select \
                        sum(soi.quantity) as qty,out.name as outlet_name, \
                        fi.name as food_item_name from sales_order so \
                        inner join sales_order_items soi on soi.sales_order_id=so.id \
                        inner join food_item fi on fi.id=soi.food_item_id \
                        inner join outlet out on  out.id=so.outlet_id \
                        where time::date=now()::date and fi.restaurant_id=$1 \
                        group by so.outlet_id,out.name,soi.food_item_id,fi.name \
                        order by out.name ",
                        [restaurant_id],
                        function (query_err, sales_data) {
                            done();
                            if (query_err) {
                                return callback(query_err, null)
                            }
                            if (sales_data.rows.length > 0) {
                                return callback(null, { taken_data: taken_result.rows[0].taken, sales_data: sales_data.rows })
                            } else {
                                return callback(new Error('No data found'))
                            }
                        });
                }
            })

    });
};

var get_sales_summary = function (restaurant_id, callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(err, null)
        }
        client.query(
            "select s.outlet_id,f.location,sum(f.mrp*si.quantity) as sale ,'Daily' as period from food_item f, \
            sales_order_items si, sales_order s where s.id=si.sales_order_id and \
            si.food_item_id=f.id and s.outlet_id=f.outlet_id and f.restaurant_id=$1 \
            and s.time >= now()::date \
            group by f.location , s.outlet_id \
            union all \
            select s.outlet_id,f.location, sum(f.mrp*si.quantity) as sale,'Monthly' as period  from food_item f, \
            sales_order_items si, sales_order s where s.id=si.sales_order_id and f.restaurant_id=$1 and  \
            si.food_item_id=f.id and s.outlet_id=f.outlet_id  \
            and to_char(time,'MMYYYY') = to_char(now(),'MMYYYY') \
            group by f.location , s.outlet_id \
            union all \
            select s.outlet_id,f.location, sum(f.mrp*si.quantity) as sale,'Weekly' as period  from food_item f, \
            sales_order_items si, sales_order s where s.id=si.sales_order_id and f.restaurant_id=$1 and \
            si.food_item_id=f.id and s.outlet_id=f.outlet_id  \
            and date_part('week',time) = date_part('week',now())  \
            group by f.location , s.outlet_id \
            union all \
            select s.outlet_id,f.location, sum(f.mrp*si.quantity) as sale,'Quarterly' as period  from food_item f, \
            sales_order_items si, sales_order s where s.id=si.sales_order_id and f.restaurant_id=$1 and \
            si.food_item_id=f.id and s.outlet_id=f.outlet_id \
            and date_part('quarter',time) = date_part('quarter',now()) \
            group by f.location , s.outlet_id \
            union all \
            select s.outlet_id,f.location, sum(f.mrp*si.quantity) as sale,'Halfyearly' as period  from food_item f, \
            sales_order_items si, sales_order s where s.id=si.sales_order_id and f.restaurant_id=$1 and \
            si.food_item_id=f.id and s.outlet_id=f.outlet_id \
            and date_part('quarter',time)  between  date_part('quarter',time) -1 and date_part('quarter',time) \
            group by f.location , s.outlet_id",
            [restaurant_id],
            function (query_err, get_sales_summary) {
                done();
                if (query_err) {
                    return callback(query_err, null)
                }
                if (get_sales_summary.rows.length > 0) {
                    return callback(null, get_sales_summary.rows)
                } else {
                    return callback(new Error('No data found'))
                }
            }
        );
    });
};

var get_restaurant_details = function (restaurant_id, callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(new Error('error fetching client from pool' + err))
        }
        client.query('select firebase_url,printer_ip,sender_email_bak,max_print_count,test_template,sender_email,mpin \
        from restaurant_config where restaurant_id=$1',
            [restaurant_id],
            function (query_err, restaurant_result) {
                done();
                if (query_err) {
                    return callback(new Error('error running query' + query_err))
                }
                if (restaurant_result.rows[0]) {
                    return callback(null, restaurant_result.rows[0])
                } else {
                    return callback(new Error('No data found'))
                }
            })
    })
}



var get_sales_data_ctrlctr = function (outlet_id, callback) {
    pg.connect(conString, function (err, client, done) {
        if (err) {
            return callback(err, null)
        }

        client.query("with podata as( \
select po.restaurant_id,po.outlet_id,pm.food_item_id,sum(coalesce(pbo.quantity,pm.quantity)) as taken \
 from (select * from purchase_order where outlet_id=$1 and to_char(scheduled_delivery_time,'DDMMYYYY')= to_char(now(),'DDMMYYYY')) as  po \
 join purchase_order_master_list pm  on po.id=pm.purchase_order_id \
left outer join \
    (select purchase_order_id,substr(pb.barcode,3,3) as outlet, \
        base36_decode(substring(pb.barcode from 9 for 4))::integer as food_item_id,  \
    sum(quantity) as quantity from purchase_order_batch pb \
     where substr(barcode,13,8) = to_char(now(),'DDMMYYYY') and substr(pb.barcode,3,3)::int=$1  \
    group by outlet,food_item_id,purchase_order_id ) as pbo \
       on pm.purchase_order_id = pbo.purchase_order_id and pm.food_item_id = pbo.food_item_id  \
group by po.restaurant_id,po.outlet_id,pm.food_item_id)  \
select podata.taken,podata.outlet_id,podata.restaurant_id,sales.sold ,  \
sales.food_item_name,sales.restaurant_name,sales.outlet_name,sales.outlet_short_name from podata \
 join \
(select sum(soi.quantity) as sold,out.id as outlet_id, out.name as outlet_name,out.short_name as outlet_short_name res.id as restaurant_id, \
fi.id as food_item_id,fi.name as food_item_name,res.name as restaurant_name from sales_order so \
                        inner join sales_order_items soi on soi.sales_order_id=so.id  \
                        inner join food_item fi on fi.id=soi.food_item_id \
                        inner join outlet out on  out.id=so.outlet_id   \
                        inner join restaurant res on res.id=fi.restaurant_id \
                        where  out.id=$1 and to_char(time,'DD-MM-YYYY')=to_char(now(),'DD-MM-YYYY') \
                        group by so.outlet_id,out.name,soi.food_item_id,fi.name,res.name ,res.id,out.id ,fi.id) as sales \
on podata.outlet_id=sales.outlet_id and podata.restaurant_id =sales.restaurant_id and podata.food_item_id=sales.food_item_id;"
            , [outlet_id],
            function (query_err, taken_result) {
                done();
                if (query_err) {
                    return callback(query_err, null)
                }
                if (taken_result.rows.length > 0) {
                    return callback(null, { taken_data: taken_result.rows })
                } else {
                    return callback(new Error('No data found'))
                }
            })
    });
};



module.exports = {
    get_live_packing_data: get_live_packing_data,
    get_session_data: get_session_data,
    initial_seed_data_signup: initial_seed_data_signup,
    get_random_pin: get_random_pin,
    update_pin_to_restaurant: update_pin_to_restaurant,
    check_credentials: check_credentials,
    get_sales_data: get_sales_data,
    get_sales_summary: get_sales_summary,
    get_sales_data_ctrlctr: get_sales_data_ctrlctr,
    get_barcode_list_from_firebase: get_barcode_list_from_firebase
}