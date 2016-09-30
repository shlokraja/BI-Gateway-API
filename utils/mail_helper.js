var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');
var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'no-reply@atchayam.in',
        pass: 'Atchayam123'
    }
});

var send_mail=function(subject,content,sender_addrs,callback){
             var mailOptions = {
                          from: 'no-reply@atchayam.in', // sender address
                          to: sender_addrs,
                          cc:'rajasekaran.mathuram@owltech.in', // list of receivers
                          subject:subject , // Subject line
                          text: content,
                          html: content
                      };

                      transporter.sendMail(mailOptions, function (error, info) {
                          if (error) {
                             return callback(new Error(" sendMail error"));
                          }

                         return callback(null,'Message sent: ' + info.response);
                      });
}

module.exports={
    send_mail:send_mail
}